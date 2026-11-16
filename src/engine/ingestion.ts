import { getDb, upsertAssetFreshness, upsertBarsTf, upsertPrices } from './db.ts';
import type { AssetRow, CryptoFuturesContractMeta, FreshnessSummary, PriceBar, Timeframe } from './types.ts';

export interface ValidationResult {
  validBars: PriceBar[];
  rejectedCount: number;
  warnings: string[];
}

export interface FetchResult {
  bars: PriceBar[];
  marketTime: string | null;
}

export interface DataSource {
  name: string;
  fetchBars(asset: AssetRow, timeframe: Timeframe, rangeYears?: number): Promise<FetchResult>;
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

function formatBarTimestamp(unixSeconds: number, timeframe: Timeframe): string {
  const iso = new Date(unixSeconds * 1000).toISOString();
  return timeframe === '1d' || timeframe === '1wk' ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

export class YahooFinanceSource implements DataSource {
  name = 'yahoo';

  async fetchBars(asset: AssetRow, timeframe: Timeframe, rangeYears = 2): Promise<FetchResult> {
    const interval = timeframe === '1h' || timeframe === '4h' ? '1h' : timeframe === '1wk' ? '1wk' : '1d';
    const range =
      interval === '1h'
        ? '60d'
        : interval === '1wk'
        ? '5y'
        : rangeYears >= 5
        ? '5y'
        : rangeYears >= 2
        ? '2y'
        : '1y';

    const encoded = encodeURIComponent(asset.symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=${range}&interval=${interval}&includeAdjustedClose=true`;
    const res = await fetchWithRetry(url, 3, 500);
    const payload = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketTime?: number };
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

    const marketTime = result.meta?.regularMarketTime
      ? new Date(result.meta.regularMarketTime * 1000).toISOString()
      : null;

    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const adj = result.indicators.adjclose?.[0]?.adjclose ?? q.close ?? [];

    const bars: PriceBar[] = [];
    const effectiveTf = interval === '1h' ? '1h' : timeframe;
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      const ac = adj[i] ?? c;
      const v = q.volume?.[i] ?? 0;
      if (o == null || h == null || l == null || c == null || ac == null) continue;
      bars.push({
        asset_id: asset.id,
        date: formatBarTimestamp(ts[i], effectiveTf),
        open: Number(o),
        high: Number(h),
        low: Number(l),
        close: Number(c),
        adj_close: Number(ac),
        volume: Number(v),
      });
    }
    return { bars, marketTime };
  }
}

export class BinanceCryptoSource implements DataSource {
  name = 'binance';
  private fallback = new YahooFinanceSource();

  async fetchBars(asset: AssetRow, timeframe: Timeframe, rangeYears = 2): Promise<FetchResult> {
    const base = asset.symbol.replace('-USD', '').toUpperCase();
    const pair = `${base}USDT`;
    const binanceInterval = timeframe === '1wk' ? '1w' : timeframe === '4h' ? '4h' : timeframe === '1h' ? '1h' : '1d';
    const limit = timeframe === '1h' ? 1000 : timeframe === '4h' ? 500 : Math.min(1000, rangeYears * 365);

    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${binanceInterval}&limit=${limit}`;
      const res = await fetchWithRetry(url, 2, 400);
      const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('Empty Binance klines');
      }
      const bars = raw.map((k) => ({
        asset_id: asset.id,
        date: formatBarTimestamp(Math.floor(k[0] / 1000), timeframe),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        adj_close: Number(k[4]),
        volume: Number(k[5]),
      }));
      return {
        bars,
        marketTime: new Date(raw[raw.length - 1][0]).toISOString(),
      };
    } catch {
      return this.fallback.fetchBars(asset, timeframe, rangeYears);
    }
  }
}

export function aggregate1hTo4h(bars1h: PriceBar[]): PriceBar[] {
  const buckets = new Map<string, PriceBar[]>();
  for (const b of bars1h) {
    // date format: "YYYY-MM-DD HH:MM"
    const [day, time] = b.date.split(' ');
    const hour = Number((time ?? '00:00').split(':')[0]);
    const bucketHour = Math.floor(hour / 4) * 4;
    const key = `${day} ${String(bucketHour).padStart(2, '0')}:00`;
    const list = buckets.get(key) ?? [];
    list.push(b);
    buckets.set(key, list);
  }
  const out: PriceBar[] = [];
  for (const [bucketKey, grp] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const first = grp[0];
    const last = grp[grp.length - 1];
    out.push({
      asset_id: first.asset_id,
      date: bucketKey,
      open: first.open,
      high: Math.max(...grp.map((x) => x.high)),
      low: Math.min(...grp.map((x) => x.low)),
      close: last.close,
      adj_close: last.adj_close,
      volume: grp.reduce((s, x) => s + x.volume, 0),
    });
  }
  return out;
}

export function validateBars(asset: AssetRow, rawBars: PriceBar[], timeframe: Timeframe = '1d'): ValidationResult {
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

    if (timeframe === '1d' && asset.asset_class !== 'crypto') {
      const dayDiff =
        (new Date(curr.date).getTime() - new Date(prev.date).getTime()) / (1000 * 60 * 60 * 24);
      if (dayDiff > 6) {
        warnings.push(`${asset.symbol}: ${Math.round(dayDiff)}d gap before ${curr.date}`);
      }
    }

    const pctMove = Math.abs(curr.adj_close - prev.adj_close) / prev.adj_close;
    if (pctMove > 0.4) {
      warnings.push(
        `${asset.symbol}: ${(pctMove * 100).toFixed(1)}% single-bar move on ${curr.date} (review split/data)`
      );
    }
  }

  return { validBars, rejectedCount, warnings };
}

export async function ingestAssets(
  assets: AssetRow[],
  rangeYears = 2,
  timeframe: Timeframe = '1d'
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
  const fetchedAt = new Date().toISOString();

  const batchSize = 6;
  for (let i = 0; i < assets.length; i += batchSize) {
    const chunk = assets.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map(async (asset) => {
        const source = asset.source === 'crypto' ? crypto : yahoo;
        // For 4h on Yahoo, fetch 1h bars and resample cleanly
        const fetchTf: Timeframe = timeframe === '4h' && source === yahoo ? '1h' : timeframe;
        const { bars: raw, marketTime } = await source.fetchBars(asset, fetchTf, rangeYears);
        const validation = validateBars(asset, raw, fetchTf);
        if (validation.validBars.length === 0) {
          throw new Error(`No valid bars after validation for ${asset.symbol}`);
        }

        let targetBars = validation.validBars;
        let count = 0;

        if (timeframe === '1d') {
          count = upsertPrices(targetBars);
        } else if (timeframe === '1h' || timeframe === '4h') {
          if (fetchTf === '1h') {
            upsertBarsTf('1h', targetBars);
            const bars4h = aggregate1hTo4h(targetBars);
            upsertBarsTf('4h', bars4h);
            const last1h = targetBars[targetBars.length - 1];
            const last4h = bars4h[bars4h.length - 1];
            if (last1h) upsertAssetFreshness(asset.id, '1h', last1h.date, marketTime, fetchedAt, targetBars.length);
            if (last4h) upsertAssetFreshness(asset.id, '4h', last4h.date, marketTime, fetchedAt, bars4h.length);
            count = timeframe === '4h' ? bars4h.length : targetBars.length;
            targetBars = timeframe === '4h' ? bars4h : targetBars;
          } else {
            count = upsertBarsTf(timeframe, targetBars);
          }
        } else {
          count = upsertBarsTf(timeframe, targetBars);
        }

        const latest = targetBars[targetBars.length - 1];
        if (latest) {
          upsertAssetFreshness(asset.id, timeframe, latest.date, marketTime, fetchedAt, targetBars.length);
        }

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

export function getFreshnessSummary(timeframe: Timeframe): FreshnessSummary {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT af.asset_id, a.symbol, a.asset_class, af.timeframe, af.last_bar_time, af.market_time, af.fetched_at, af.bar_count
       FROM asset_freshness af
       JOIN assets a ON a.id = af.asset_id
       WHERE af.timeframe = ? AND a.active = 1 AND a.asset_class != 'benchmark'`
    )
    .all(timeframe) as Array<{
    asset_id: number;
    symbol: string;
    asset_class: string;
    timeframe: Timeframe;
    last_bar_time: string;
    market_time: string | null;
    fetched_at: string;
    bar_count: number;
  }>;

  // Fallback for 1d if prices_daily existed before asset_freshness table was added
  if (rows.length === 0 && timeframe === '1d') {
    const fallback = db
      .prepare(
        `SELECT a.id as asset_id, a.symbol, a.asset_class, MAX(p.date) as last_bar_time, COUNT(*) as bar_count
         FROM assets a
         JOIN prices_daily p ON p.asset_id = a.id
         WHERE a.active = 1 AND a.asset_class != 'benchmark'
         GROUP BY a.id`
      )
      .all() as Array<{ asset_id: number; symbol: string; asset_class: string; last_bar_time: string; bar_count: number }>;

    const lastRun = db
      .prepare("SELECT finished_at FROM pipeline_runs WHERE status IN ('completed','partial') ORDER BY finished_at DESC LIMIT 1")
      .get() as { finished_at: string | null } | undefined;

    for (const f of fallback) {
      rows.push({
        asset_id: f.asset_id,
        symbol: f.symbol,
        asset_class: f.asset_class,
        timeframe: '1d',
        last_bar_time: f.last_bar_time,
        market_time: null,
        fetched_at: lastRun?.finished_at ?? new Date().toISOString(),
        bar_count: f.bar_count,
      });
    }
  }

  const byClass: FreshnessSummary['byClass'] = {};
  let latestBarOverall: string | null = null;
  let lastFetchedAt: string | null = null;

  for (const r of rows) {
    if (!latestBarOverall || r.last_bar_time > latestBarOverall) latestBarOverall = r.last_bar_time;
    if (!lastFetchedAt || r.fetched_at > lastFetchedAt) lastFetchedAt = r.fetched_at;

    const bucket = byClass[r.asset_class] ?? {
      assetsCount: 0,
      latestBarTime: null,
      latestMarketTime: null,
      lastFetchedAt: null,
    };
    bucket.assetsCount++;
    if (!bucket.latestBarTime || r.last_bar_time > bucket.latestBarTime) bucket.latestBarTime = r.last_bar_time;
    if (r.market_time && (!bucket.latestMarketTime || r.market_time > bucket.latestMarketTime)) {
      bucket.latestMarketTime = r.market_time;
    }
    if (!bucket.lastFetchedAt || r.fetched_at > bucket.lastFetchedAt) bucket.lastFetchedAt = r.fetched_at;
    byClass[r.asset_class] = bucket;
  }

  let status: FreshnessSummary['status'] = 'Stale';
  let statusReason = `No ingested ${timeframe} bars found yet.`;

  if (lastFetchedAt) {
    const ageMs = Date.now() - new Date(lastFetchedAt).getTime();
    const ageMin = Math.round(ageMs / 60000);
    const maxCurrentMin = timeframe === '1h' || timeframe === '4h' ? 20 : 12 * 60;
    const maxAgingMin = timeframe === '1h' || timeframe === '4h' ? 120 : 36 * 60;

    if (ageMin <= maxCurrentMin) {
      status = 'Current';
      statusReason =
        ageMin < 1
          ? `Synced just now (${latestBarOverall ?? ''}).`
          : `Synced ${ageMin}m ago · latest bar ${latestBarOverall ?? ''}.`;
    } else if (ageMin <= maxAgingMin) {
      status = 'Aging';
      const hrs = Math.round(ageMin / 60);
      statusReason = `Synced ${ageMin < 60 ? `${ageMin}m` : `${hrs}h`} ago · latest bar ${latestBarOverall ?? ''}.`;
    } else {
      status = 'Stale';
      const hrs = Math.round(ageMin / 60);
      statusReason = `Last synced ${hrs}h ago · refresh to pull latest candles.`;
    }
  }

  return {
    timeframe,
    status,
    statusReason,
    lastFetchedAt,
    latestBarOverall,
    byClass,
  };
}

let cachedPerpMap: { fetchedAtMs: number; map: Map<string, CryptoFuturesContractMeta> } | null = null;
const cachedOiMap = new Map<string, { fetchedAtMs: number; units: number }>();

export function toPerpSymbol(symbol: string): string {
  const base = symbol.replace(/-USD$/i, '').replace(/USDT$/i, '').toUpperCase();
  return `${base}USDT`;
}

export async function fetchBinancePerpTelemetryMap(): Promise<Map<string, CryptoFuturesContractMeta>> {
  const now = Date.now();
  if (cachedPerpMap && now - cachedPerpMap.fetchedAtMs < 30_000) {
    return cachedPerpMap.map;
  }

  const map = new Map<string, CryptoFuturesContractMeta>();
  try {
    const res = await fetchWithRetry('https://fapi.binance.com/fapi/v1/premiumIndex', 2, 400);
    const list = (await res.json()) as Array<{
      symbol: string;
      markPrice: string;
      indexPrice: string;
      lastFundingRate: string;
      nextFundingTime: number;
    }>;
    const fetchedAt = new Date().toISOString();
    for (const row of list) {
      if (!row.symbol.endsWith('USDT')) continue;
      const mark = Number(row.markPrice);
      const idx = Number(row.indexPrice);
      const fr = Number(row.lastFundingRate);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      const basisPct = idx > 0 ? ((mark - idx) / idx) * 100 : 0;
      const frPct = fr * 100;
      map.set(row.symbol, {
        perpSymbol: row.symbol,
        markPrice: mark,
        indexPrice: idx > 0 ? idx : mark,
        basisPct: Number(basisPct.toFixed(4)),
        fundingRate: fr,
        fundingRatePct: Number(frPct.toFixed(4)),
        annualizedFundingPct: Number((frPct * 3 * 365).toFixed(2)),
        nextFundingTime: row.nextFundingTime ? new Date(row.nextFundingTime).toISOString() : null,
        openInterestUnits: null,
        openInterestUsd: null,
        fetchedAt,
      });
    }
    cachedPerpMap = { fetchedAtMs: now, map };
  } catch {
    if (cachedPerpMap) return cachedPerpMap.map;
  }
  return map;
}

export async function fetchCryptoFuturesContract(symbol: string): Promise<CryptoFuturesContractMeta | null> {
  const perpSymbol = toPerpSymbol(symbol);
  const map = await fetchBinancePerpTelemetryMap();
  const base = map.get(perpSymbol);
  if (!base) return null;

  const now = Date.now();
  const cachedOi = cachedOiMap.get(perpSymbol);
  let oiUnits = cachedOi && now - cachedOi.fetchedAtMs < 30_000 ? cachedOi.units : null;

  if (oiUnits == null) {
    try {
      const res = await fetchWithRetry(
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(perpSymbol)}`,
        2,
        300
      );
      const payload = (await res.json()) as { openInterest?: string };
      const parsed = Number(payload.openInterest);
      if (Number.isFinite(parsed) && parsed > 0) {
        oiUnits = parsed;
        cachedOiMap.set(perpSymbol, { fetchedAtMs: now, units: parsed });
      }
    } catch {
      oiUnits = cachedOi?.units ?? null;
    }
  }

  return {
    ...base,
    openInterestUnits: oiUnits != null ? Number(oiUnits.toFixed(2)) : null,
    openInterestUsd: oiUnits != null ? Number((oiUnits * base.markPrice).toFixed(0)) : null,
  };
}
