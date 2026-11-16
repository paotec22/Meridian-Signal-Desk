import { loadConfig } from './config.ts';
import { getBarsForAsset, getDb } from './db.ts';
import { computeRiskLevels, filterByCorrelation } from './risk.ts';
import type {
  AppConfig,
  AssetRow,
  IndicatorRow,
  RegimeStatus,
  SignalDirection,
  SignalRecord,
  Timeframe,
} from './types.ts';

export interface ScoreBreakdown {
  longScore: number;
  shortScore: number;
  direction: SignalDirection;
  finalScore: number;
  reasons: string[];
}

export function getMarketRegime(timeframe: Timeframe = '1d'): RegimeStatus {
  const db = getDb();
  const cfg = loadConfig();

  const getLatest = (symbol: string) => {
    if (timeframe === '1d') {
      return db
        .prepare(
          `SELECT p.close, i.sma_50, i.sma_200
           FROM assets a
           JOIN prices_daily p ON p.asset_id = a.id
           LEFT JOIN indicators_daily i ON i.asset_id = a.id AND i.date = p.date
           WHERE a.symbol = ?
           ORDER BY p.date DESC LIMIT 1`
        )
        .get(symbol) as { close: number; sma_50: number | null; sma_200: number | null } | undefined;
    }
    return db
      .prepare(
        `SELECT p.close, i.sma_50, i.sma_200
         FROM assets a
         JOIN bars_tf p ON p.asset_id = a.id AND p.timeframe = ?
         LEFT JOIN indicators_tf i ON i.asset_id = a.id AND i.timeframe = p.timeframe AND i.date = p.date
         WHERE a.symbol = ?
         ORDER BY p.date DESC LIMIT 1`
      )
      .get(timeframe, symbol) as { close: number; sma_50: number | null; sma_200: number | null } | undefined;
  };

  const spx = getLatest(cfg.universe.stocks_benchmark);
  const btc = getLatest(cfg.universe.crypto_benchmark);
  const dxy = getLatest(cfg.universe.commodities_benchmark);

  const sp500Close = spx?.close ?? 0;
  const sp500Sma200 = spx?.sma_200 ?? spx?.sma_50 ?? sp500Close;
  const sp500Bullish = sp500Close > 0 && sp500Close >= sp500Sma200;

  const btcClose = btc?.close ?? 0;
  const btcSma200 = btc?.sma_200 ?? btc?.sma_50 ?? btcClose;
  const btcBullish = btcClose > 0 && btcClose >= btcSma200;

  const dxyClose = dxy?.close ?? 0;
  const dxySma50 = dxy?.sma_50 ?? dxyClose;

  const anchorLabel = spx?.sma_200 != null ? '200MA' : '50MA';
  const spxLabel = sp500Bullish
    ? `S&P 500 above ${anchorLabel} (Bullish)`
    : `S&P 500 below ${anchorLabel} (Caution)`;
  const btcLabel = btcBullish ? `BTC above ${anchorLabel}` : `BTC below ${anchorLabel}`;

  return {
    sp500Close,
    sp500Sma200,
    sp500Bullish,
    btcClose,
    btcSma200,
    btcBullish,
    dxyClose,
    dxySma50,
    summary: `${spxLabel} | ${btcLabel}`,
  };
}

export function scoreAssetRow(
  assetClass: string,
  close: number,
  prevClose: number,
  ind: IndicatorRow,
  regime: RegimeStatus,
  cfg: AppConfig
): ScoreBreakdown {
  const w = cfg.scoring_weights;
  const t = cfg.scoring_thresholds;

  let longScore = 0;
  let shortScore = 0;
  const longReasons: string[] = [];
  const shortReasons: string[] = [];

  if (ind.sma_50 != null) {
    if (close > ind.sma_50) {
      longScore += w.above_sma50;
      longReasons.push(`Above 50MA (${ind.sma_50.toFixed(2)})`);
    } else if (close < ind.sma_50) {
      shortScore += w.above_sma50;
      shortReasons.push(`Below 50MA (${ind.sma_50.toFixed(2)})`);
    }
  }

  // Fallback to 20MA vs 50MA alignment if history has <200 bars (e.g. 4h equity window)
  if (ind.sma_200 != null) {
    if (close > ind.sma_200) {
      longScore += w.above_sma200;
      longReasons.push(`Above 200MA`);
    } else if (close < ind.sma_200) {
      shortScore += w.above_sma200;
      shortReasons.push(`Below 200MA`);
    }

    if (ind.sma_50 != null) {
      if (ind.sma_50 > ind.sma_200) {
        longScore += w.sma50_above_sma200;
        longReasons.push('50MA > 200MA trend alignment');
      } else if (ind.sma_50 < ind.sma_200) {
        shortScore += w.sma50_above_sma200;
        shortReasons.push('50MA < 200MA downtrend');
      }
    }
  } else if (ind.sma_20 != null && ind.sma_50 != null) {
    if (close > ind.sma_20) {
      longScore += w.above_sma200;
      longReasons.push(`Above 20MA (${ind.sma_20.toFixed(2)})`);
    } else if (close < ind.sma_20) {
      shortScore += w.above_sma200;
      shortReasons.push(`Below 20MA (${ind.sma_20.toFixed(2)})`);
    }

    if (ind.sma_20 > ind.sma_50) {
      longScore += w.sma50_above_sma200;
      longReasons.push('20MA > 50MA short-term alignment');
    } else if (ind.sma_20 < ind.sma_50) {
      shortScore += w.sma50_above_sma200;
      shortReasons.push('20MA < 50MA downtrend');
    }
  }

  if (ind.rsi_14 != null) {
    if (ind.rsi_14 >= t.long_rsi_min && ind.rsi_14 <= t.long_rsi_max) {
      longScore += w.rsi_momentum_band;
      longReasons.push(`RSI ${ind.rsi_14.toFixed(1)} in bullish band`);
    } else if (ind.rsi_14 >= t.short_rsi_min && ind.rsi_14 < t.short_rsi_max) {
      shortScore += w.rsi_momentum_band;
      shortReasons.push(`RSI ${ind.rsi_14.toFixed(1)} in bearish band`);
    }
  }

  if (ind.adx_14 != null && ind.adx_14 >= t.adx_min) {
    longScore += w.adx_trend_strength;
    shortScore += w.adx_trend_strength;
    const msg = `ADX ${ind.adx_14.toFixed(1)} trend strength`;
    longReasons.push(msg);
    shortReasons.push(msg);
  }

  if (ind.macd != null && ind.macd_signal != null) {
    if (ind.macd > ind.macd_signal) {
      longScore += w.macd_cross;
      longReasons.push('MACD above signal');
    } else if (ind.macd < ind.macd_signal) {
      shortScore += w.macd_cross;
      shortReasons.push('MACD below signal');
    }
  }

  const isUpDay = close >= prevClose;
  if (ind.vol_ratio_20 != null && ind.vol_ratio_20 >= t.vol_ratio_min) {
    if (isUpDay) {
      longScore += w.volume_confirmation;
      longReasons.push(`Volume ${ind.vol_ratio_20.toFixed(2)}x avg on up bar`);
    } else {
      shortScore += w.volume_confirmation;
      shortReasons.push(`Volume ${ind.vol_ratio_20.toFixed(2)}x avg on down bar`);
    }
  }

  if (ind.rel_strength != null) {
    if (ind.rel_strength > 0) {
      longScore += w.relative_strength;
      longReasons.push(`Outperforming benchmark (+${(ind.rel_strength * 100).toFixed(1)}%)`);
    } else if (ind.rel_strength < 0) {
      shortScore += w.relative_strength;
      shortReasons.push(`Underperforming benchmark (${(ind.rel_strength * 100).toFixed(1)}%)`);
    }
  }

  const isBullishRegime = assetClass === 'crypto' ? regime.btcBullish : regime.sp500Bullish;
  if (!isBullishRegime) {
    longScore = Math.round(longScore * cfg.regime.bearish_long_multiplier);
  }

  let direction: SignalDirection = 'avoid';
  const finalScore = Math.max(longScore, shortScore);
  let reasons: string[] = longScore >= shortScore ? longReasons : shortReasons;

  if (finalScore >= cfg.filters.avoid_threshold) {
    direction = longScore >= shortScore ? 'long' : 'short';
  } else {
    reasons = [`Score ${finalScore} below ${cfg.filters.avoid_threshold} conviction floor`];
  }

  return {
    longScore: Math.round(longScore),
    shortScore: Math.round(shortScore),
    direction,
    finalScore: Math.round(finalScore),
    reasons,
  };
}

export function generateDailySignals(
  equity?: number,
  riskPct?: number,
  timeframe: Timeframe = '1d'
): {
  signals: SignalRecord[];
  regime: RegimeStatus;
  asOfDate: string;
} {
  const db = getDb();
  const cfg = loadConfig();
  const regime = getMarketRegime(timeframe);
  const accountEquity = equity ?? cfg.risk.default_account_equity;
  const riskPercent = riskPct ?? cfg.risk.default_risk_pct;

  const minBarsRequired =
    timeframe === '4h' ? 60 : timeframe === '1h' ? 120 : timeframe === '1wk' ? 104 : cfg.filters.min_history_days;

  const assets = db
    .prepare("SELECT * FROM assets WHERE active = 1 AND asset_class != 'benchmark'")
    .all() as unknown as AssetRow[];

  const rawCandidates: SignalRecord[] = [];
  let latestGlobalDate = new Date().toISOString().slice(0, 10);

  for (const asset of assets) {
    const bars = getBarsForAsset(asset.id, timeframe, 'DESC', 260);
    if (bars.length < minBarsRequired) continue;

    const latestBar = bars[0];
    const prevBar = bars[1];
    if (rawCandidates.length === 0 || latestBar.date > latestGlobalDate) {
      latestGlobalDate = latestBar.date;
    }

    const ind =
      timeframe === '1d'
        ? (db
            .prepare('SELECT * FROM indicators_daily WHERE asset_id = ? AND date = ?')
            .get(asset.id, latestBar.date) as unknown as IndicatorRow | undefined)
        : (db
            .prepare('SELECT * FROM indicators_tf WHERE asset_id = ? AND timeframe = ? AND date = ?')
            .get(asset.id, timeframe, latestBar.date) as unknown as IndicatorRow | undefined);

    if (!ind || ind.atr_14 == null || ind.sma_50 == null) continue;

    // Liquidity filter scaled cleanly to bar timeframe
    const scaleFactor = timeframe === '1wk' ? 4 : timeframe === '4h' ? 0.25 : timeframe === '1h' ? 0.08 : 1;
    const minDollarVol =
      (asset.asset_class === 'stock'
        ? cfg.filters.min_stock_dollar_volume_20d
        : asset.asset_class === 'crypto'
        ? cfg.filters.min_crypto_dollar_volume_20d
        : cfg.filters.min_commodity_dollar_volume_20d) * scaleFactor;

    if ((ind.dollar_vol_20 ?? 0) < minDollarVol) continue;

    const breakdown = scoreAssetRow(
      asset.asset_class,
      latestBar.close,
      prevBar.close,
      ind,
      regime,
      cfg
    );

    const levels = computeRiskLevels(
      breakdown.direction === 'avoid' ? 'long' : breakdown.direction,
      latestBar.close,
      ind.atr_14,
      bars.slice(0, 60),
      accountEquity,
      riskPercent,
      cfg
    );

    const effectiveDirection: SignalDirection =
      breakdown.direction !== 'avoid' && levels.riskReward < cfg.risk.min_risk_reward
        ? 'avoid'
        : breakdown.direction;

    rawCandidates.push({
      date: latestBar.date,
      asset_id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      asset_class: asset.asset_class,
      sector: asset.sector,
      direction: effectiveDirection,
      long_score: breakdown.longScore,
      short_score: breakdown.shortScore,
      score: breakdown.finalScore,
      close: Number(latestBar.close.toFixed(4)),
      entry_low: levels.entryLow,
      entry_high: levels.entryHigh,
      stop_loss: levels.stopLoss,
      take_profit: levels.takeProfit,
      risk_reward: levels.riskReward,
      position_pct: levels.positionPct,
      reasons: breakdown.reasons,
      regime: regime.summary,
    });
  }

  rawCandidates.sort((a, b) => b.score - a.score);

  const actionable = rawCandidates.filter(
    (s) => s.direction !== 'avoid' && s.score >= cfg.filters.avoid_threshold
  );
  const diversified = filterByCorrelation(
    actionable,
    cfg.risk.correlation_window_days,
    cfg.risk.max_pair_correlation,
    timeframe
  );

  const selectedIds = new Set<number>();
  const classCounts: Record<string, number> = {};
  let longCount = 0;

  for (const sig of diversified) {
    if (selectedIds.size >= cfg.filters.max_picks_total) break;
    const cCount = classCounts[sig.asset_class] ?? 0;
    if (cCount >= cfg.filters.max_picks_per_class) continue;
    const isBullish = sig.asset_class === 'crypto' ? regime.btcBullish : regime.sp500Bullish;
    if (!isBullish && sig.direction === 'long' && longCount >= cfg.regime.bearish_max_long_picks) {
      continue;
    }
    selectedIds.add(sig.asset_id);
    classCounts[sig.asset_class] = cCount + 1;
    if (sig.direction === 'long') longCount++;
  }

  if (timeframe === '1d') {
    const upsertStmt = db.prepare(`
      INSERT INTO signals (
        date, asset_id, direction, long_score, short_score, score, close,
        entry_low, entry_high, stop_loss, take_profit, risk_reward, position_pct,
        reasons_json, regime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, asset_id) DO UPDATE SET
        direction = excluded.direction,
        long_score = excluded.long_score,
        short_score = excluded.short_score,
        score = excluded.score,
        close = excluded.close,
        entry_low = excluded.entry_low,
        entry_high = excluded.entry_high,
        stop_loss = excluded.stop_loss,
        take_profit = excluded.take_profit,
        risk_reward = excluded.risk_reward,
        position_pct = excluded.position_pct,
        reasons_json = excluded.reasons_json,
        regime = excluded.regime
    `);

    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const s of rawCandidates) {
        upsertStmt.run(
          s.date, s.asset_id, s.direction, s.long_score, s.short_score, s.score, s.close,
          s.entry_low, s.entry_high, s.stop_loss, s.take_profit, s.risk_reward, s.position_pct,
          JSON.stringify(s.reasons), s.regime
        );
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } else {
    const upsertTfStmt = db.prepare(`
      INSERT INTO signals_tf (
        timeframe, date, asset_id, direction, long_score, short_score, score, close,
        entry_low, entry_high, stop_loss, take_profit, risk_reward, position_pct,
        reasons_json, regime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(timeframe, date, asset_id) DO UPDATE SET
        direction = excluded.direction,
        long_score = excluded.long_score,
        short_score = excluded.short_score,
        score = excluded.score,
        close = excluded.close,
        entry_low = excluded.entry_low,
        entry_high = excluded.entry_high,
        stop_loss = excluded.stop_loss,
        take_profit = excluded.take_profit,
        risk_reward = excluded.risk_reward,
        position_pct = excluded.position_pct,
        reasons_json = excluded.reasons_json,
        regime = excluded.regime
    `);

    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const s of rawCandidates) {
        upsertTfStmt.run(
          timeframe, s.date, s.asset_id, s.direction, s.long_score, s.short_score, s.score, s.close,
          s.entry_low, s.entry_high, s.stop_loss, s.take_profit, s.risk_reward, s.position_pct,
          JSON.stringify(s.reasons), s.regime
        );
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  return {
    signals: rawCandidates,
    regime,
    asOfDate: latestGlobalDate,
  };
}
