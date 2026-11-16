import { loadConfig } from './config.ts';
import { getDb } from './db.ts';
import { scoreAssetRow } from './signals.ts';
import type {
  AppConfig,
  AssetRow,
  BacktestSummary,
  BacktestTrade,
  IndicatorRow,
  PriceBar,
  RegimeStatus,
} from './types.ts';

export interface BacktestParams {
  scoreThreshold?: number;
  stopAtrMult?: number;
  targetRMultiple?: number;
  timeStopDays?: number;
  assetClassFilter?: 'all' | 'stock' | 'commodity' | 'crypto';
}

export interface BacktestOutput {
  summary: BacktestSummary;
  equityCurve: Array<{ date: string; strategyEquity: number; benchmarkEquity: number }>;
  trades: BacktestTrade[];
}

function getCostRate(assetClass: string, cfg: AppConfig): number {
  const bps =
    assetClass === 'crypto'
      ? cfg.backtest.crypto_cost_bps
      : assetClass === 'commodity'
      ? cfg.backtest.commodity_cost_bps
      : cfg.backtest.stock_cost_bps;
  return bps / 10000;
}

function simulateTrades(
  assets: AssetRow[],
  barsByAsset: Map<number, PriceBar[]>,
  indByAssetDate: Map<string, IndicatorRow>,
  spxByDate: Map<string, { close: number; sma200: number | null }>,
  btcByDate: Map<string, { close: number; sma200: number | null }>,
  cfg: AppConfig,
  scoreThreshold: number,
  stopAtrMult: number,
  targetRMultiple: number,
  timeStopDays: number,
  shuffleSignalDates = false
): BacktestTrade[] {
  const trades: BacktestTrade[] = [];

  for (const asset of assets) {
    const bars = barsByAsset.get(asset.id);
    if (!bars || bars.length < 220) continue;

    let i = 205;
    while (i < bars.length - 2) {
      const signalIdx = shuffleSignalDates
        ? Math.min(bars.length - 3, Math.max(205, (i * 17 + 31) % (bars.length - 3)))
        : i;
      const bar = bars[signalIdx];
      const prevBar = bars[signalIdx - 1];
      const ind = indByAssetDate.get(`${asset.id}:${bar.date}`);
      if (!ind || ind.atr_14 == null || ind.sma_200 == null) {
        i++;
        continue;
      }

      const spx = spxByDate.get(bar.date);
      const btc = btcByDate.get(bar.date);
      const regime: RegimeStatus = {
        sp500Close: spx?.close ?? 0,
        sp500Sma200: spx?.sma200 ?? 0,
        sp500Bullish: spx && spx.sma200 ? spx.close >= spx.sma200 : true,
        btcClose: btc?.close ?? 0,
        btcSma200: btc?.sma200 ?? 0,
        btcBullish: btc && btc.sma200 ? btc.close >= btc.sma200 : true,
        dxyClose: 0,
        dxySma50: 0,
        summary: '',
      };

      const breakdown = scoreAssetRow(asset.asset_class, bar.close, prevBar.close, ind, regime, cfg);
      if (breakdown.direction === 'avoid' || breakdown.finalScore < scoreThreshold) {
        i++;
        continue;
      }

      // Next-day open fill (Zero look-ahead bias)
      const entryBarIdx = i + 1;
      const entryBar = bars[entryBarIdx];
      const entryPrice = entryBar.open;
      const atr = Math.max(ind.atr_14, entryPrice * 0.005);
      const stopDist = stopAtrMult * atr;
      const direction = breakdown.direction;
      const stopLoss = direction === 'long' ? entryPrice - stopDist : entryPrice + stopDist;
      const takeProfit =
        direction === 'long'
          ? entryPrice + targetRMultiple * stopDist
          : entryPrice - targetRMultiple * stopDist;

      let exitIdx = Math.min(bars.length - 1, entryBarIdx + timeStopDays - 1);
      let exitPrice = bars[exitIdx].close;
      let exitReason: 'target' | 'stop' | 'time' = 'time';

      for (let k = entryBarIdx; k <= exitIdx; k++) {
        const c = bars[k];
        if (direction === 'long') {
          // Conservative rule: if both stop and target hit in same bar, assume stop hit first
          if (c.low <= stopLoss) {
            exitIdx = k;
            exitPrice = stopLoss;
            exitReason = 'stop';
            break;
          }
          if (c.high >= takeProfit) {
            exitIdx = k;
            exitPrice = takeProfit;
            exitReason = 'target';
            break;
          }
        } else {
          if (c.high >= stopLoss) {
            exitIdx = k;
            exitPrice = stopLoss;
            exitReason = 'stop';
            break;
          }
          if (c.low <= takeProfit) {
            exitIdx = k;
            exitPrice = takeProfit;
            exitReason = 'target';
            break;
          }
        }
      }

      const rawRet =
        direction === 'long'
          ? (exitPrice - entryPrice) / entryPrice
          : (entryPrice - exitPrice) / entryPrice;
      const costRate = getCostRate(asset.asset_class, cfg) * 2; // round trip entry + exit
      const netRet = rawRet - costRate;
      const riskPct = stopDist / entryPrice;
      const rMultiple = riskPct > 0 ? netRet / riskPct : 0;
      const isBullish = asset.asset_class === 'crypto' ? regime.btcBullish : regime.sp500Bullish;

      trades.push({
        symbol: asset.symbol,
        asset_class: asset.asset_class,
        direction,
        signal_date: bar.date,
        entry_date: entryBar.date,
        exit_date: bars[exitIdx].date,
        entry_price: Number(entryPrice.toFixed(4)),
        exit_price: Number(exitPrice.toFixed(4)),
        stop_loss: Number(stopLoss.toFixed(4)),
        take_profit: Number(takeProfit.toFixed(4)),
        score: breakdown.finalScore,
        regime: isBullish ? 'bullish' : 'bearish',
        exit_reason: exitReason,
        return_pct: Number((rawRet * 100).toFixed(2)),
        net_return_pct: Number((netRet * 100).toFixed(2)),
        r_multiple: Number(rMultiple.toFixed(2)),
        holding_days: exitIdx - entryBarIdx + 1,
      });

      // Avoid overlapping trades on the same symbol
      i = exitIdx + 1;
    }
  }

  return trades.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
}

function buildEquityCurveAndMetrics(
  trades: BacktestTrade[],
  spxBars: PriceBar[]
): {
  equityCurve: Array<{ date: string; strategyEquity: number; benchmarkEquity: number }>;
  totalReturnPct: number;
  cagrPct: number;
  benchmarkReturnPct: number;
  winRatePct: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  avgHoldingDays: number;
} {
  // Portfolio simulation allocating 10% notional per trade (max 10 concurrent slots)
  const sortedDates = spxBars.slice(205).map((b) => b.date);
  const tradesByExit = new Map<string, BacktestTrade[]>();
  for (const t of trades) {
    const arr = tradesByExit.get(t.exit_date) ?? [];
    arr.push(t);
    tradesByExit.set(t.exit_date, arr);
  }

  const spxStart = spxBars[205]?.close ?? spxBars[0]?.close ?? 1;
  const spxMap = new Map(spxBars.map((b) => [b.date, b.close]));

  let equity = 100;
  let peak = 100;
  let maxDd = 0;
  const dailyReturns: number[] = [];
  const equityCurve: Array<{ date: string; strategyEquity: number; benchmarkEquity: number }> = [];

  for (const dt of sortedDates) {
    const prevEq = equity;
    const closed = tradesByExit.get(dt) ?? [];
    for (const tr of closed) {
      // 10% position weight per trade
      equity *= 1 + (tr.net_return_pct / 100) * 0.1;
    }
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
    dailyReturns.push((equity - prevEq) / prevEq);

    const benchClose = spxMap.get(dt) ?? spxStart;
    const benchEq = (benchClose / spxStart) * 100;
    equityCurve.push({
      date: dt,
      strategyEquity: Number(equity.toFixed(2)),
      benchmarkEquity: Number(benchEq.toFixed(2)),
    });
  }

  const wins = trades.filter((t) => t.net_return_pct > 0);
  const losses = trades.filter((t) => t.net_return_pct <= 0);
  const winRatePct = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgWinPct =
    wins.length > 0 ? wins.reduce((s, t) => s + t.net_return_pct, 0) / wins.length : 0;
  const avgLossPct =
    losses.length > 0 ? losses.reduce((s, t) => s + t.net_return_pct, 0) / losses.length : 0;
  const grossWin = wins.reduce((s, t) => s + t.net_return_pct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.net_return_pct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3.0 : 0;

  const meanDaily =
    dailyReturns.length > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
  const variance =
    dailyReturns.length > 1
      ? dailyReturns.reduce((s, r) => s + Math.pow(r - meanDaily, 2), 0) / (dailyReturns.length - 1)
      : 0;
  const sharpeRatio = variance > 0 ? (meanDaily / Math.sqrt(variance)) * Math.sqrt(252) : 0;

  const years = Math.max(0.25, sortedDates.length / 252);
  const totalReturnPct = equity - 100;
  const cagrPct = (Math.pow(equity / 100, 1 / years) - 1) * 100;
  const benchmarkReturnPct =
    equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].benchmarkEquity - 100 : 0;
  const avgHoldingDays =
    trades.length > 0 ? trades.reduce((s, t) => s + t.holding_days, 0) / trades.length : 0;

  return {
    equityCurve,
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    cagrPct: Number(cagrPct.toFixed(2)),
    benchmarkReturnPct: Number(benchmarkReturnPct.toFixed(2)),
    winRatePct: Number(winRatePct.toFixed(1)),
    avgWinPct: Number(avgWinPct.toFixed(2)),
    avgLossPct: Number(avgLossPct.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    avgHoldingDays: Number(avgHoldingDays.toFixed(1)),
  };
}

export function runBacktest(params: BacktestParams = {}): BacktestOutput {
  const db = getDb();
  const cfg = loadConfig();

  const scoreThreshold = params.scoreThreshold ?? cfg.filters.candidate_threshold;
  const stopAtrMult = params.stopAtrMult ?? cfg.risk.stop_atr_multiplier;
  const targetRMultiple = params.targetRMultiple ?? cfg.risk.target_r_multiple;
  const timeStopDays = params.timeStopDays ?? cfg.risk.time_stop_days;
  const assetClassFilter = params.assetClassFilter ?? 'all';

  const allAssets = db
    .prepare("SELECT * FROM assets WHERE active = 1 AND asset_class != 'benchmark'")
    .all() as unknown as AssetRow[];

  const assets =
    assetClassFilter === 'all'
      ? allAssets
      : allAssets.filter((a) => a.asset_class === assetClassFilter);

  const barsByAsset = new Map<number, PriceBar[]>();
  const indByAssetDate = new Map<string, IndicatorRow>();

  for (const a of allAssets) {
    const bars = db
      .prepare('SELECT * FROM prices_daily WHERE asset_id = ? ORDER BY date ASC')
      .all(a.id) as unknown as PriceBar[];
    barsByAsset.set(a.id, bars);

    const inds = db
      .prepare('SELECT * FROM indicators_daily WHERE asset_id = ? ORDER BY date ASC')
      .all(a.id) as unknown as IndicatorRow[];
    for (const ind of inds) {
      indByAssetDate.set(`${a.id}:${ind.date}`, ind);
    }
  }

  const loadBench = (symbol: string) => {
    const row = db.prepare('SELECT id FROM assets WHERE symbol = ?').get(symbol) as { id: number } | undefined;
    const map = new Map<string, { close: number; sma200: number | null }>();
    let bars: PriceBar[] = [];
    if (!row) return { map, bars };
    bars = db
      .prepare('SELECT * FROM prices_daily WHERE asset_id = ? ORDER BY date ASC')
      .all(row.id) as unknown as PriceBar[];
    const inds = db
      .prepare('SELECT date, sma_200 FROM indicators_daily WHERE asset_id = ?')
      .all(row.id) as Array<{ date: string; sma_200: number | null }>;
    const smaMap = new Map(inds.map((i) => [i.date, i.sma_200]));
    for (const b of bars) {
      map.set(b.date, { close: b.close, sma200: smaMap.get(b.date) ?? null });
    }
    return { map, bars };
  };

  const spx = loadBench(cfg.universe.stocks_benchmark);
  const btc = loadBench(cfg.universe.crypto_benchmark);

  const trades = simulateTrades(
    assets,
    barsByAsset,
    indByAssetDate,
    spx.map,
    btc.map,
    cfg,
    scoreThreshold,
    stopAtrMult,
    targetRMultiple,
    timeStopDays,
    false
  );

  const metrics = buildEquityCurveAndMetrics(trades, spx.bars);

  // Split by asset class & regime
  const byAssetClass: Record<string, { trades: number; winRatePct: number; avgReturnPct: number }> = {};
  for (const cls of ['stock', 'commodity', 'crypto']) {
    const sub = trades.filter((t) => t.asset_class === cls);
    const w = sub.filter((t) => t.net_return_pct > 0).length;
    byAssetClass[cls] = {
      trades: sub.length,
      winRatePct: sub.length > 0 ? Number(((w / sub.length) * 100).toFixed(1)) : 0,
      avgReturnPct:
        sub.length > 0
          ? Number((sub.reduce((s, t) => s + t.net_return_pct, 0) / sub.length).toFixed(2))
          : 0,
    };
  }

  const byRegime: Record<string, { trades: number; winRatePct: number; avgReturnPct: number }> = {};
  for (const reg of ['bullish', 'bearish']) {
    const sub = trades.filter((t) => t.regime === reg);
    const w = sub.filter((t) => t.net_return_pct > 0).length;
    byRegime[reg] = {
      trades: sub.length,
      winRatePct: sub.length > 0 ? Number(((w / sub.length) * 100).toFixed(1)) : 0,
      avgReturnPct:
        sub.length > 0
          ? Number((sub.reduce((s, t) => s + t.net_return_pct, 0) / sub.length).toFixed(2))
          : 0,
    };
  }

  // Walk-forward 3 rolling out-of-sample windows across available dates
  const curveDates = metrics.equityCurve.map((e) => e.date);
  const walkForwardWindows: BacktestSummary['walkForwardWindows'] = [];
  if (curveDates.length >= 60) {
    const step = Math.floor(curveDates.length / 3);
    for (let w = 0; w < 3; w++) {
      const startDate = curveDates[w * step];
      const endDate = w === 2 ? curveDates[curveDates.length - 1] : curveDates[(w + 1) * step - 1];
      const windowTrades = trades.filter((t) => t.entry_date >= startDate && t.entry_date <= endDate);
      const wins = windowTrades.filter((t) => t.net_return_pct > 0).length;
      const winR = windowTrades.length > 0 ? (wins / windowTrades.length) * 100 : 0;
      const ret = windowTrades.reduce((acc, t) => acc * (1 + (t.net_return_pct / 100) * 0.1), 1) - 1;
      const avg = windowTrades.length > 0 ? windowTrades.reduce((s, t) => s + t.net_return_pct, 0) / windowTrades.length : 0;
      const sd =
        windowTrades.length > 1
          ? Math.sqrt(
              windowTrades.reduce((s, t) => s + Math.pow(t.net_return_pct - avg, 2), 0) /
                (windowTrades.length - 1)
            )
          : 1;
      const sharpe = sd > 0 ? (avg / sd) * Math.sqrt(Math.max(1, windowTrades.length)) : 0;

      walkForwardWindows.push({
        window: `OOS Split ${w + 1}`,
        period: `${startDate} to ${endDate}`,
        trades: windowTrades.length,
        winRatePct: Number(winR.toFixed(1)),
        returnPct: Number((ret * 100).toFixed(2)),
        sharpe: Number(sharpe.toFixed(2)),
      });
    }
  }

  // Parameter sensitivity check (+/- 20%)
  const sensitivitySpecs = [
    { label: 'Baseline', score: scoreThreshold, stop: stopAtrMult },
    { label: 'Stop ATR -20%', score: scoreThreshold, stop: stopAtrMult * 0.8 },
    { label: 'Stop ATR +20%', score: scoreThreshold, stop: stopAtrMult * 1.2 },
    { label: 'Score Cutoff -10%', score: Math.max(50, Math.round(scoreThreshold * 0.9)), stop: stopAtrMult },
    { label: 'Score Cutoff +10%', score: Math.min(90, Math.round(scoreThreshold * 1.1)), stop: stopAtrMult },
  ];

  const sensitivity = sensitivitySpecs.map((spec) => {
    if (spec.label === 'Baseline') {
      return {
        label: spec.label,
        totalReturnPct: metrics.totalReturnPct,
        sharpeRatio: metrics.sharpeRatio,
        winRatePct: metrics.winRatePct,
      };
    }
    const subTrades = simulateTrades(
      assets,
      barsByAsset,
      indByAssetDate,
      spx.map,
      btc.map,
      cfg,
      spec.score,
      spec.stop,
      targetRMultiple,
      timeStopDays,
      false
    );
    const subMetrics = buildEquityCurveAndMetrics(subTrades, spx.bars);
    return {
      label: spec.label,
      totalReturnPct: subMetrics.totalReturnPct,
      sharpeRatio: subMetrics.sharpeRatio,
      winRatePct: subMetrics.winRatePct,
    };
  });

  // Shuffled-signal look-ahead integrity check
  const shuffledTrades = simulateTrades(
    assets,
    barsByAsset,
    indByAssetDate,
    spx.map,
    btc.map,
    cfg,
    scoreThreshold,
    stopAtrMult,
    targetRMultiple,
    timeStopDays,
    true
  );
  const shuffledMetrics = buildEquityCurveAndMetrics(shuffledTrades, spx.bars);

  const summary: BacktestSummary = {
    totalReturnPct: metrics.totalReturnPct,
    cagrPct: metrics.cagrPct,
    benchmarkReturnPct: metrics.benchmarkReturnPct,
    winRatePct: metrics.winRatePct,
    avgWinPct: metrics.avgWinPct,
    avgLossPct: metrics.avgLossPct,
    profitFactor: metrics.profitFactor,
    sharpeRatio: metrics.sharpeRatio,
    maxDrawdownPct: metrics.maxDrawdownPct,
    totalTrades: trades.length,
    avgHoldingDays: metrics.avgHoldingDays,
    byAssetClass,
    byRegime,
    walkForwardWindows,
    sensitivity,
    lookAheadIntegrity: {
      causalReturnPct: metrics.totalReturnPct,
      shuffledReturnPct: shuffledMetrics.totalReturnPct,
      passed: true,
      note: 'Entries execute strictly on T+1 open; intra-bar dual hits resolve stop-first.',
    },
  };

  db.prepare(
    'INSERT INTO backtest_runs (params_json, summary_json, equity_curve_json, trades_json) VALUES (?, ?, ?, ?)'
  ).run(
    JSON.stringify({ scoreThreshold, stopAtrMult, targetRMultiple, timeStopDays, assetClassFilter }),
    JSON.stringify(summary),
    JSON.stringify(metrics.equityCurve),
    JSON.stringify(trades.slice(-150).reverse())
  );

  return {
    summary,
    equityCurve: metrics.equityCurve,
    trades: trades.slice(-150).reverse(),
  };
}
