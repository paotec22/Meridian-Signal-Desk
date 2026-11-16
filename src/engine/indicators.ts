import { getBarsForAsset, upsertIndicators } from './db.ts';
import type { AssetRow, IndicatorRow, PriceBar, Timeframe } from './types.ts';

function computeSma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function computeEma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder's RSI(14) matching TradingView standard
function computeWilderRsi(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) avgGain += delta;
    else avgLoss -= delta;
  }
  avgGain /= period;
  avgLoss /= period;

  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// Wilder's ATR(14) matching TradingView standard
function computeWilderAtr(bars: PriceBar[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;

  const tr: number[] = new Array(bars.length).fill(0);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  let atr = 0;
  for (let i = 1; i <= period; i++) atr += tr[i];
  atr /= period;
  out[period] = atr;

  for (let i = period + 1; i < bars.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

// Wilder's ADX(14)
function computeWilderAdx(bars: PriceBar[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(bars.length).fill(null);
  if (bars.length < period * 2 + 1) return out;

  const tr: number[] = new Array(bars.length).fill(0);
  const plusDm: number[] = new Array(bars.length).fill(0);
  const minusDm: number[] = new Array(bars.length).fill(0);

  for (let i = 1; i < bars.length; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
  }

  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  for (let i = 1; i <= period; i++) {
    smoothTr += tr[i];
    smoothPlus += plusDm[i];
    smoothMinus += minusDm[i];
  }

  const dx: Array<number | null> = new Array(bars.length).fill(null);
  for (let i = period; i < bars.length; i++) {
    if (i > period) {
      smoothTr = smoothTr - smoothTr / period + tr[i];
      smoothPlus = smoothPlus - smoothPlus / period + plusDm[i];
      smoothMinus = smoothMinus - smoothMinus / period + minusDm[i];
    }
    const plusDi = smoothTr === 0 ? 0 : (100 * smoothPlus) / smoothTr;
    const minusDi = smoothTr === 0 ? 0 : (100 * smoothMinus) / smoothTr;
    const denom = plusDi + minusDi;
    dx[i] = denom === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / denom;
  }

  let adxSeed = 0;
  for (let i = period; i < period * 2; i++) {
    adxSeed += dx[i] ?? 0;
  }
  let adx = adxSeed / period;
  out[period * 2 - 1] = adx;

  for (let i = period * 2; i < bars.length; i++) {
    adx = (adx * (period - 1) + (dx[i] ?? 0)) / period;
    out[i] = adx;
  }
  return out;
}

export function computeAssetIndicators(
  asset: AssetRow,
  bars: PriceBar[],
  benchmarkClosesByDate: Map<string, number>
): IndicatorRow[] {
  if (bars.length === 0) return [];
  const closes = bars.map((b) => b.adj_close || b.close);
  const volumes = bars.map((b) => b.volume);

  const sma20 = computeSma(closes, 20);
  const sma50 = computeSma(closes, 50);
  const sma200 = computeSma(closes, 200);
  const ema12 = computeEma(closes, 12);
  const ema26 = computeEma(closes, 26);
  const rsi14 = computeWilderRsi(closes, 14);
  const atr14 = computeWilderAtr(bars, 14);
  const adx14 = computeWilderAdx(bars, 14);
  const volSma20 = computeSma(volumes, 20);

  // MACD line & 9-period EMA signal
  const macdLine: Array<number | null> = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? (ema12[i] as number) - (ema26[i] as number) : null
  );
  const validMacdStart = macdLine.findIndex((v) => v != null);
  const macdSignal: Array<number | null> = new Array(closes.length).fill(null);
  if (validMacdStart >= 0) {
    const macdTail = macdLine.slice(validMacdStart).map((v) => v ?? 0);
    const sigTail = computeEma(macdTail, 9);
    for (let i = 0; i < sigTail.length; i++) {
      macdSignal[validMacdStart + i] = sigTail[i];
    }
  }

  const rows: IndicatorRow[] = [];
  for (let i = 0; i < bars.length; i++) {
    const c = closes[i];
    const bar = bars[i];

    // Bollinger Width (20, 2sd)
    let bbWidth: number | null = null;
    if (i >= 19 && sma20[i] != null && sma20[i]! > 0) {
      const mean = sma20[i]!;
      let sq = 0;
      for (let j = i - 19; j <= i; j++) {
        sq += Math.pow(closes[j] - mean, 2);
      }
      const sd = Math.sqrt(sq / 20);
      bbWidth = (4 * sd) / mean;
    }

    const volRatio20 =
      volSma20[i] != null && volSma20[i]! > 0 ? bar.volume / volSma20[i]! : null;

    // 20-day avg dollar volume
    let dollarVol20: number | null = null;
    if (i >= 19) {
      let sumDv = 0;
      for (let j = i - 19; j <= i; j++) {
        sumDv += closes[j] * bars[j].volume;
      }
      dollarVol20 = sumDv / 20;
    }

    const ret3m = i >= 63 ? (c - closes[i - 63]) / closes[i - 63] : null;
    const ret6m = i >= 126 ? (c - closes[i - 126]) / closes[i - 126] : null;
    const ret12m = i >= 252 ? (c - closes[i - 252]) / closes[i - 252] : null;

    // Relative strength vs benchmark over 63 trading days
    let relStrength: number | null = null;
    if (ret3m != null && i >= 63) {
      const benchNow = benchmarkClosesByDate.get(bar.date);
      const benchPrev = benchmarkClosesByDate.get(bars[i - 63].date);
      if (benchNow != null && benchPrev != null && benchPrev > 0) {
        const benchRet = (benchNow - benchPrev) / benchPrev;
        // For commodities measured against DXY, inverse USD move serves as macro tailwind
        relStrength = asset.asset_class === 'commodity' ? ret3m + benchRet * 0.5 : ret3m - benchRet;
      } else {
        relStrength = ret3m;
      }
    }

    // Distance from 52-week high (252 bars causal window)
    const lookbackStart = Math.max(0, i - 251);
    let high52w = closes[lookbackStart];
    for (let j = lookbackStart + 1; j <= i; j++) {
      if (bars[j].high > high52w) high52w = bars[j].high;
    }
    const pctFrom52wHigh = high52w > 0 ? (c - high52w) / high52w : null;

    rows.push({
      asset_id: asset.id,
      date: bar.date,
      sma_20: sma20[i],
      sma_50: sma50[i],
      sma_200: sma200[i],
      ema_12: ema12[i],
      ema_26: ema26[i],
      rsi_14: rsi14[i],
      atr_14: atr14[i],
      adx_14: adx14[i],
      macd: macdLine[i],
      macd_signal: macdSignal[i],
      bb_width: bbWidth,
      vol_ratio_20: volRatio20,
      ret_3m: ret3m,
      ret_6m: ret6m,
      ret_12m: ret12m,
      rel_strength: relStrength,
      pct_from_52w_high: pctFrom52wHigh,
      dollar_vol_20: dollarVol20,
    });
  }
  return rows;
}

export function recomputeAllIndicators(assets: AssetRow[], timeframe: Timeframe = '1d'): number {
  const loadBars = (symbol: string): Map<string, number> => {
    const map = new Map<string, number>();
    const asset = assets.find((a) => a.symbol === symbol);
    if (!asset) return map;
    const rows = getBarsForAsset(asset.id, timeframe, 'ASC');
    for (const r of rows) map.set(r.date, r.adj_close);
    return map;
  };

  const spxMap = loadBars('^GSPC');
  const btcMap = loadBars('BTC-USD');
  const dxyMap = loadBars('DX-Y.NYB');

  let totalUpdated = 0;
  for (const asset of assets) {
    const bars = getBarsForAsset(asset.id, timeframe, 'ASC');
    if (bars.length === 0) continue;

    const benchMap =
      asset.asset_class === 'crypto'
        ? btcMap
        : asset.asset_class === 'commodity'
        ? dxyMap
        : spxMap;

    const indRows = computeAssetIndicators(asset, bars, benchMap);
    totalUpdated += upsertIndicators(indRows, timeframe);
  }
  return totalUpdated;
}
