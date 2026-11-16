import { upsertPrices } from './db.ts';
import type { AssetRow, PriceBar } from './types.ts';

export interface ValidationResult {
  validBars: PriceBar[];
  rejectedCount: number;
  warnings: string[];
}

export interface DataSource {
  name: string;
  fetchDaily(asset: AssetRow, rangeYears?: number): Promise<PriceBar[]>;
}

async function fetchWithRetry(url: string, retries = 3, delayMs = 600): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MeridianSignalDesk/1.0)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
      } else {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
  }
  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

export class YahooFinanceSource implements DataSource {
  name = 'yahoo';

  async fetchDaily(asset: AssetRow, rangeYears = 2): Promise<PriceBar[]> {
    const range = rangeYears >= 5 ? '5y' : rangeYears >= 2 ? '2y' : '1y';
    const encoded = encodeURIComponent(asset.symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=${range}&interval=1d&includeAdjustedClose=true`;
    const res = await fetchWithRetry(url, 3, 500);
    const payload = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
            adjclose?: Array<{ adjclose?: Array<number | null> }>;
          };
        }>;
        error?: { description?: string };
      };
    };

    const result = payload.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      const msg = payload.chart?.error?.description ?? 'Empty chart payload';
      throw new Error(`Yahoo returned no data for ${asset.symbol}: ${msg}`);
    }

    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const adj = result.indicators.adjclose?.[0]?.adjclose ?? q.close ?? [];

    const bars: PriceBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      const ac = adj[i] ?? c;
      const v = q.volume?.[i] ?? 0;
      if (o == null || h == null || l == null || c == null || ac == null) continue;
      const dateStr = new Date(ts[i] * 1000).toISOString().slice(0, 10);
      bars.push({
        asset_id: asset.id,
        date: dateStr,
        open: Number(o),
        high: Number(h),
        low: Number(l),
        close: Number(c),
        adj_close: Number(ac),
        volume: Number(v),
      });
    }
    return bars;
  }
}

export class BinanceCryptoSource implements DataSource {
  name = 'binance';
  private fallback = new YahooFinanceSource();

  async fetchDaily(asset: AssetRow, rangeYears = 2): Promise<PriceBar[]> {
    const base = asset.symbol.replace('-USD', '').toUpperCase();
    const pair = `${base}USDT`;
    const limit = Math.min(1000, rangeYears * 365);
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&limit=${limit}`;
      const res = await fetchWithRetry(url, 2, 400);
      const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('Empty Binance klines');
      }
      return raw.map((k) => ({
        asset_id: asset.id,
        date: new Date(k[0]).toISOString().slice(0, 10),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        adj_close: Number(k[4]),
        volume: Number(k[5]),
      }));
    } catch {
      // Automatic source fallback per Phase 3 architecture
      return this.fallback.fetchDaily(asset, rangeYears);
    }
  }
}

export function validateBars(asset: AssetRow, rawBars: PriceBar[]): ValidationResult {
  const seenDates = new Set<string>();
  const validBars: PriceBar[] = [];
  const warnings: string[] = [];
  let rejectedCount = 0;

  const sorted = [...rawBars].sort((a, b) => a.date.localeCompare(b.date));

  for (const bar of sorted) {
    if (seenDates.has(bar.date)) {
      rejectedCount++;
      continue;
    }
    if (
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close) ||
      bar.open <= 0 ||
      bar.high <= 0 ||
      bar.low <= 0 ||
      bar.close <= 0 ||
      bar.high < bar.low
    ) {
      rejectedCount++;
      continue;
    }
    seenDates.add(bar.date);
    validBars.push(bar);
  }

  for (let i = 1; i < validBars.length; i++) {
    const prev = validBars[i - 1];
    const curr = validBars[i];

    // Check trading gap > 5 calendar days for stocks/commodities
    const dayDiff =
      (new Date(curr.date).getTime() - new Date(prev.date).getTime()) / (1000 * 60 * 60 * 24);
    if (asset.asset_class !== 'crypto' && dayDiff > 6) {
      warnings.push(`${asset.symbol}: ${Math.round(dayDiff)}d gap before ${curr.date}`);
    }

    // Check single-day move > 40%
    const pctMove = Math.abs(curr.adj_close - prev.adj_close) / prev.adj_close;
    if (pctMove > 0.4) {
      warnings.push(
        `${asset.symbol}: ${(pctMove * 100).toFixed(1)}% single-day move on ${curr.date} (review split/data)`
      );
    }
  }

  return { validBars, rejectedCount, warnings };
}

export async function ingestAssets(
  assets: AssetRow[],
  rangeYears = 2
): Promise<{
  processed: number;
  barsInserted: number;
  errors: string[];
  warnings: string[];
}> {
  const yahoo = new YahooFinanceSource();
  const crypto = new BinanceCryptoSource();
  const errors: string[] = [];
  const warnings: string[] = [];
  let processed = 0;
  let barsInserted = 0;

  // Concurrency batching of 6 requests to respect public rate limits
  const batchSize = 6;
  for (let i = 0; i < assets.length; i += batchSize) {
    const chunk = assets.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map(async (asset) => {
        const source = asset.source === 'crypto' ? crypto : yahoo;
        const raw = await source.fetchDaily(asset, rangeYears);
        const validation = validateBars(asset, raw);
        if (validation.validBars.length === 0) {
          throw new Error(`No valid bars after validation for ${asset.symbol}`);
        }
        const count = upsertPrices(validation.validBars);
        return { symbol: asset.symbol, count, warnings: validation.warnings };
      })
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const asset = chunk[j];
      if (r.status === 'fulfilled') {
        processed++;
        barsInserted += r.value.count;
        if (r.value.warnings.length > 0) {
          warnings.push(...r.value.warnings.slice(-2));
        }
      } else {
        errors.push(`${asset.symbol}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    }
  }

  return { processed, barsInserted, errors, warnings };
}
