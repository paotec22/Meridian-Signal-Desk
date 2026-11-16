import { loadConfig } from './config.ts';
import { getDb } from './db.ts';
import { computeRiskLevels } from './risk.ts';
import { getMarketRegime, scoreAssetRow } from './signals.ts';
import type { AssetRow, ExitReason, IndicatorRow, PriceBar, SignalOutcomeRow } from './types.ts';

export function seedRecentHistoricalSignalsIfNeeded(): void {
  const db = getDb();
  const cfg = loadConfig();
  const countRow = db.prepare('SELECT COUNT(DISTINCT date) as cnt FROM signals').get() as { cnt: number };
  if (countRow.cnt >= 8) return;

  const regime = getMarketRegime();
  const assets = db
    .prepare("SELECT * FROM assets WHERE active = 1 AND asset_class != 'benchmark'")
    .all() as unknown as AssetRow[];

  // Sample historical weekly checkpoints across the last 55 trading days so track record reflects real paper performance
  const spxRow = db.prepare('SELECT id FROM assets WHERE symbol = ?').get(cfg.universe.stocks_benchmark) as
    | { id: number }
    | undefined;
  if (!spxRow) return;

  const refDates = (
    db
      .prepare('SELECT date FROM prices_daily WHERE asset_id = ? ORDER BY date DESC LIMIT 65')
      .all(spxRow.id) as Array<{ date: string }>
  )
    .map((r) => r.date)
    .reverse();

  if (refDates.length < 25) return;

  const checkpoints: string[] = [];
  for (let idx = 5; idx < refDates.length - 3; idx += 7) {
    checkpoints.push(refDates[idx]);
  }

  const upsertStmt = db.prepare(`
    INSERT OR IGNORE INTO signals (
      date, asset_id, direction, long_score, short_score, score, close,
      entry_low, entry_high, stop_loss, take_profit, risk_reward, position_pct,
      reasons_json, regime
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const dt of checkpoints) {
      const candidates: Array<{
        asset: AssetRow;
        close: number;
        score: number;
        longScore: number;
        shortScore: number;
        direction: 'long' | 'short';
        reasons: string[];
        atr: number;
        barsDesc: PriceBar[];
      }> = [];

      for (const asset of assets) {
        const barsDesc = db
          .prepare('SELECT * FROM prices_daily WHERE asset_id = ? AND date <= ? ORDER BY date DESC LIMIT 60')
          .all(asset.id, dt) as unknown as PriceBar[];
        if (barsDesc.length < 3) continue;
        const ind = db
          .prepare('SELECT * FROM indicators_daily WHERE asset_id = ? AND date = ?')
          .get(asset.id, barsDesc[0].date) as unknown as IndicatorRow | undefined;
        if (!ind || ind.atr_14 == null || ind.sma_200 == null) continue;

        const breakdown = scoreAssetRow(
          asset.asset_class,
          barsDesc[0].close,
          barsDesc[1].close,
          ind,
          regime,
          cfg
        );
        if (breakdown.direction === 'avoid' || breakdown.finalScore < cfg.filters.candidate_threshold) {
          continue;
        }
        candidates.push({
          asset,
          close: barsDesc[0].close,
          score: breakdown.finalScore,
          longScore: breakdown.longScore,
          shortScore: breakdown.shortScore,
          direction: breakdown.direction,
          reasons: breakdown.reasons,
          atr: ind.atr_14,
          barsDesc,
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      for (const c of candidates.slice(0, 5)) {
        const levels = computeRiskLevels(
          c.direction,
          c.close,
          c.atr,
          c.barsDesc,
          cfg.risk.default_account_equity,
          cfg.risk.default_risk_pct,
          cfg
        );
        if (levels.riskReward < cfg.risk.min_risk_reward) continue;
        upsertStmt.run(
          dt,
          c.asset.id,
          c.direction,
          c.longScore,
          c.shortScore,
          c.score,
          Number(c.close.toFixed(4)),
          levels.entryLow,
          levels.entryHigh,
          levels.stopLoss,
          levels.takeProfit,
          levels.riskReward,
          levels.positionPct,
          JSON.stringify(c.reasons),
          regime.summary
        );
      }
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export function evaluateSignalOutcomes(): SignalOutcomeRow[] {
  seedRecentHistoricalSignalsIfNeeded();
  const db = getDb();
  const cfg = loadConfig();
  const timeStopDays = cfg.risk.time_stop_days;

  const sigRows = db
    .prepare(
      `SELECT s.*, a.symbol, a.name, a.asset_class
       FROM signals s
       JOIN assets a ON a.id = s.asset_id
       WHERE s.direction != 'avoid' AND s.score >= ?
       ORDER BY s.date DESC, s.score DESC`
    )
    .all(cfg.filters.avoid_threshold) as Array<{
    id: number;
    date: string;
    asset_id: number;
    symbol: string;
    name: string;
    asset_class: AssetRow['asset_class'];
    direction: 'long' | 'short';
    score: number;
    close: number;
    stop_loss: number;
    take_profit: number;
  }>;

  const upsertOutcome = db.prepare(`
    INSERT INTO signal_outcomes (
      signal_id, evaluated_at, status, exit_reason, exit_price, return_pct, holding_days, r_multiple
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signal_id) DO UPDATE SET
      evaluated_at = excluded.evaluated_at,
      status = excluded.status,
      exit_reason = excluded.exit_reason,
      exit_price = excluded.exit_price,
      return_pct = excluded.return_pct,
      holding_days = excluded.holding_days,
      r_multiple = excluded.r_multiple
  `);

  const today = new Date().toISOString().slice(0, 10);
  const results: SignalOutcomeRow[] = [];

  for (const sig of sigRows) {
    const forwardBars = db
      .prepare('SELECT * FROM prices_daily WHERE asset_id = ? AND date > ? ORDER BY date ASC LIMIT ?')
      .all(sig.asset_id, sig.date, timeStopDays + 2) as unknown as PriceBar[];

    if (forwardBars.length === 0) {
      // Latest signal with no T+1 candle yet
      upsertOutcome.run(sig.id, today, 'open', 'open', sig.close, 0, 0, 0);
      results.push({
        signal_id: sig.id,
        symbol: sig.symbol,
        name: sig.name,
        asset_class: sig.asset_class,
        signal_date: sig.date,
        direction: sig.direction,
        score: sig.score,
        entry_price: sig.close,
        stop_loss: sig.stop_loss,
        take_profit: sig.take_profit,
        evaluated_at: today,
        status: 'open',
        exit_reason: 'open',
        exit_price: sig.close,
        return_pct: 0,
        holding_days: 0,
        r_multiple: 0,
      });
      continue;
    }

    const entryPrice = forwardBars[0].open;
    const stopDist = Math.max(Math.abs(entryPrice - sig.stop_loss), entryPrice * 0.005);
    let status: 'open' | 'closed' = 'open';
    let exitReason: ExitReason = 'open';
    let exitPrice = forwardBars[forwardBars.length - 1].close;
    let holdingDays = forwardBars.length;

    for (let i = 0; i < Math.min(forwardBars.length, timeStopDays); i++) {
      const b = forwardBars[i];
      if (sig.direction === 'long') {
        if (b.low <= sig.stop_loss) {
          status = 'closed';
          exitReason = 'stop';
          exitPrice = sig.stop_loss;
          holdingDays = i + 1;
          break;
        }
        if (b.high >= sig.take_profit) {
          status = 'closed';
          exitReason = 'target';
          exitPrice = sig.take_profit;
          holdingDays = i + 1;
          break;
        }
      } else {
        if (b.high >= sig.stop_loss) {
          status = 'closed';
          exitReason = 'stop';
          exitPrice = sig.stop_loss;
          holdingDays = i + 1;
          break;
        }
        if (b.low <= sig.take_profit) {
          status = 'closed';
          exitReason = 'target';
          exitPrice = sig.take_profit;
          holdingDays = i + 1;
          break;
        }
      }
    }

    if (status === 'open' && forwardBars.length >= timeStopDays) {
      status = 'closed';
      exitReason = 'time';
      exitPrice = forwardBars[timeStopDays - 1].close;
      holdingDays = timeStopDays;
    }

    const rawRet =
      sig.direction === 'long'
        ? (exitPrice - entryPrice) / entryPrice
        : (entryPrice - exitPrice) / entryPrice;
    const returnPct = Number((rawRet * 100).toFixed(2));
    const rMultiple = Number(((Math.abs(exitPrice - entryPrice) / stopDist) * (rawRet >= 0 ? 1 : -1)).toFixed(2));

    upsertOutcome.run(sig.id, today, status, exitReason, exitPrice, returnPct, holdingDays, rMultiple);
    results.push({
      signal_id: sig.id,
      symbol: sig.symbol,
      name: sig.name,
      asset_class: sig.asset_class,
      signal_date: sig.date,
      direction: sig.direction,
      score: sig.score,
      entry_price: Number(entryPrice.toFixed(4)),
      stop_loss: sig.stop_loss,
      take_profit: sig.take_profit,
      evaluated_at: today,
      status,
      exit_reason: exitReason,
      exit_price: Number(exitPrice.toFixed(4)),
      return_pct: returnPct,
      holding_days: holdingDays,
      r_multiple: rMultiple,
    });
  }

  return results;
}
