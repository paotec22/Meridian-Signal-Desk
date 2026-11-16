import { getDb } from './db.ts';
import type { AppConfig, PriceBar, SignalRecord } from './types.ts';

export interface RiskLevels {
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  positionPct: number;
  shares: number;
  dollarRisk: number;
}

function roundPrice(val: number): number {
  if (val >= 100) return Number(val.toFixed(2));
  if (val >= 1) return Number(val.toFixed(3));
  return Number(val.toFixed(5));
}

export function computeRiskLevels(
  direction: 'long' | 'short',
  close: number,
  atr: number,
  recentBarsDesc: PriceBar[],
  accountEquity: number,
  riskPct: number,
  cfg: AppConfig
): RiskLevels {
  const safeAtr = Math.max(atr, close * 0.005);
  const band = cfg.risk.entry_atr_band * safeAtr;
  const stopDist = cfg.risk.stop_atr_multiplier * safeAtr;

  // Recent 40-day swing high/low reference for resistance/support
  const slice = recentBarsDesc.slice(1, 41);
  let swingHigh = close * 1.1;
  let swingLow = close * 0.9;
  if (slice.length > 0) {
    swingHigh = Math.max(...slice.map((b) => b.high));
    swingLow = Math.min(...slice.map((b) => b.low));
  }

  let entryLow: number;
  let entryHigh: number;
  let stopLoss: number;
  let takeProfit: number;

  if (direction === 'long') {
    entryLow = close;
    entryHigh = close + band;
    stopLoss = close - stopDist;
    const minTarget = close + cfg.risk.target_r_multiple * stopDist;
    takeProfit = swingHigh > minTarget * 1.01 ? Math.min(swingHigh, close + 3.2 * stopDist) : minTarget;
  } else {
    entryLow = close - band;
    entryHigh = close;
    stopLoss = close + stopDist;
    const minTarget = close - cfg.risk.target_r_multiple * stopDist;
    takeProfit = swingLow < minTarget * 0.99 ? Math.max(swingLow, close - 3.2 * stopDist) : minTarget;
  }

  const riskPerUnit = Math.max(Math.abs(close - stopLoss), 1e-6);
  const rewardPerUnit = Math.abs(takeProfit - close);
  const riskReward = Number((rewardPerUnit / riskPerUnit).toFixed(2));

  const dollarRiskTarget = accountEquity * (riskPct / 100);
  const rawShares = dollarRiskTarget / riskPerUnit;
  const maxPositionDollars = accountEquity * (cfg.risk.max_position_pct / 100);
  const rawPositionDollars = rawShares * close;
  const cappedPositionDollars = Math.min(rawPositionDollars, maxPositionDollars);
  const shares = close > 0 ? Number((cappedPositionDollars / close).toFixed(2)) : 0;
  const positionPct = accountEquity > 0 ? Number(((cappedPositionDollars / accountEquity) * 100).toFixed(2)) : 0;
  const actualDollarRisk = Number((shares * riskPerUnit).toFixed(2));

  return {
    entryLow: roundPrice(entryLow),
    entryHigh: roundPrice(entryHigh),
    stopLoss: roundPrice(stopLoss),
    takeProfit: roundPrice(takeProfit),
    riskReward,
    positionPct,
    shares,
    dollarRisk: actualDollarRisk,
  };
}

export function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return denom === 0 ? 0 : num / denom;
}

export function getReturnSeriesMap(assetIds: number[], windowDays = 60): Map<number, number[]> {
  const db = getDb();
  const map = new Map<number, number[]>();
  for (const id of assetIds) {
    const rows = db
      .prepare('SELECT adj_close FROM prices_daily WHERE asset_id = ? ORDER BY date DESC LIMIT ?')
      .all(id, windowDays + 1) as Array<{ adj_close: number }>;
    if (rows.length < 15) continue;
    const asc = rows.reverse();
    const rets: number[] = [];
    for (let i = 1; i < asc.length; i++) {
      rets.push((asc[i].adj_close - asc[i - 1].adj_close) / asc[i - 1].adj_close);
    }
    map.set(id, rets);
  }
  return map;
}

export function filterByCorrelation(
  sortedCandidates: SignalRecord[],
  windowDays = 60,
  maxCorr = 0.8
): SignalRecord[] {
  const returnsMap = getReturnSeriesMap(
    sortedCandidates.map((c) => c.asset_id),
    windowDays
  );
  const kept: SignalRecord[] = [];
  for (const cand of sortedCandidates) {
    const candRets = returnsMap.get(cand.asset_id);
    let tooCorrelated = false;
    if (candRets) {
      for (const prev of kept) {
        const prevRets = returnsMap.get(prev.asset_id);
        if (!prevRets) continue;
        const corr = pearsonCorrelation(candRets, prevRets);
        if (corr > maxCorr) {
          tooCorrelated = true;
          break;
        }
      }
    }
    if (!tooCorrelated) kept.push(cand);
  }
  return kept;
}

export function computeCorrelationMatrix(
  signals: Array<{ asset_id: number; symbol: string }>,
  windowDays = 60
): { symbols: string[]; matrix: number[][] } {
  const top = signals.slice(0, 8);
  const returnsMap = getReturnSeriesMap(
    top.map((s) => s.asset_id),
    windowDays
  );
  const symbols = top.map((s) => s.symbol);
  const matrix: number[][] = top.map((rowAsset, i) =>
    top.map((colAsset, j) => {
      if (i === j) return 1;
      const rA = returnsMap.get(rowAsset.asset_id);
      const rB = returnsMap.get(colAsset.asset_id);
      if (!rA || !rB) return 0;
      return Number(pearsonCorrelation(rA, rB).toFixed(2));
    })
  );
  return { symbols, matrix };
}
