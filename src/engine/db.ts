import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AssetClass, AssetRow, IndicatorRow, PriceBar, Timeframe } from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'signals.db');

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  dbInstance = db;
  return db;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      sector TEXT NOT NULL DEFAULT 'General',
      source TEXT NOT NULL DEFAULT 'yahoo',
      active INTEGER NOT NULL DEFAULT 1,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prices_daily (
      asset_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      adj_close REAL NOT NULL,
      volume REAL NOT NULL,
      PRIMARY KEY (asset_id, date),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_prices_date ON prices_daily(date);

    CREATE TABLE IF NOT EXISTS bars_tf (
      asset_id INTEGER NOT NULL,
      timeframe TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      adj_close REAL NOT NULL,
      volume REAL NOT NULL,
      PRIMARY KEY (asset_id, timeframe, date),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bars_tf_lookup ON bars_tf(timeframe, asset_id, date);

    CREATE TABLE IF NOT EXISTS indicators_daily (
      asset_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      sma_20 REAL,
      sma_50 REAL,
      sma_200 REAL,
      ema_12 REAL,
      ema_26 REAL,
      rsi_14 REAL,
      atr_14 REAL,
      adx_14 REAL,
      macd REAL,
      macd_signal REAL,
      bb_width REAL,
      vol_ratio_20 REAL,
      ret_3m REAL,
      ret_6m REAL,
      ret_12m REAL,
      rel_strength REAL,
      pct_from_52w_high REAL,
      dollar_vol_20 REAL,
      PRIMARY KEY (asset_id, date),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS indicators_tf (
      asset_id INTEGER NOT NULL,
      timeframe TEXT NOT NULL,
      date TEXT NOT NULL,
      sma_20 REAL,
      sma_50 REAL,
      sma_200 REAL,
      ema_12 REAL,
      ema_26 REAL,
      rsi_14 REAL,
      atr_14 REAL,
      adx_14 REAL,
      macd REAL,
      macd_signal REAL,
      bb_width REAL,
      vol_ratio_20 REAL,
      ret_3m REAL,
      ret_6m REAL,
      ret_12m REAL,
      rel_strength REAL,
      pct_from_52w_high REAL,
      dollar_vol_20 REAL,
      PRIMARY KEY (asset_id, timeframe, date),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      long_score REAL NOT NULL,
      short_score REAL NOT NULL,
      score REAL NOT NULL,
      close REAL NOT NULL,
      entry_low REAL NOT NULL,
      entry_high REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      risk_reward REAL NOT NULL,
      position_pct REAL NOT NULL,
      reasons_json TEXT NOT NULL,
      regime TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (date, asset_id),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS signals_tf (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timeframe TEXT NOT NULL,
      date TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      long_score REAL NOT NULL,
      short_score REAL NOT NULL,
      score REAL NOT NULL,
      close REAL NOT NULL,
      entry_low REAL NOT NULL,
      entry_high REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      risk_reward REAL NOT NULL,
      position_pct REAL NOT NULL,
      reasons_json TEXT NOT NULL,
      regime TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (timeframe, date, asset_id),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_freshness (
      asset_id INTEGER NOT NULL,
      timeframe TEXT NOT NULL,
      last_bar_time TEXT NOT NULL,
      market_time TEXT,
      fetched_at TEXT NOT NULL,
      bar_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (asset_id, timeframe),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS signal_outcomes (
      signal_id INTEGER PRIMARY KEY,
      evaluated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      exit_reason TEXT NOT NULL,
      exit_price REAL NOT NULL,
      return_pct REAL NOT NULL,
      holding_days INTEGER NOT NULL,
      r_multiple REAL NOT NULL,
      FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      run_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      assets_processed INTEGER NOT NULL DEFAULT 0,
      signals_generated INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      warnings_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      params_json TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      equity_curve_json TEXT NOT NULL,
      trades_json TEXT NOT NULL
    );
  `);
}

export function upsertAsset(
  symbol: string,
  name: string,
  assetClass: AssetClass,
  sector: string,
  source: string,
  active = 1
): AssetRow {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO assets (symbol, name, asset_class, sector, source, active)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      name = excluded.name,
      asset_class = excluded.asset_class,
      sector = excluded.sector,
      source = excluded.source,
      active = excluded.active
  `);
  stmt.run(symbol, name, assetClass, sector, source, active);
  return db.prepare('SELECT * FROM assets WHERE symbol = ?').get(symbol) as unknown as AssetRow;
}

export function upsertPrices(bars: PriceBar[]): number {
  if (bars.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO prices_daily (asset_id, date, open, high, low, close, adj_close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, date) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      adj_close = excluded.adj_close,
      volume = excluded.volume
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const b of bars) {
      stmt.run(b.asset_id, b.date, b.open, b.high, b.low, b.close, b.adj_close, b.volume);
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return bars.length;
}

export function upsertBarsTf(timeframe: Timeframe, bars: PriceBar[]): number {
  if (timeframe === '1d') return upsertPrices(bars);
  if (bars.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO bars_tf (asset_id, timeframe, date, open, high, low, close, adj_close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, timeframe, date) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      adj_close = excluded.adj_close,
      volume = excluded.volume
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const b of bars) {
      stmt.run(b.asset_id, timeframe, b.date, b.open, b.high, b.low, b.close, b.adj_close, b.volume);
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return bars.length;
}

export function getBarsForAsset(assetId: number, timeframe: Timeframe, order: 'ASC' | 'DESC' = 'ASC', limit?: number): PriceBar[] {
  const db = getDb();
  const limitSql = limit != null ? `LIMIT ${Number(limit)}` : '';
  if (timeframe === '1d') {
    return db
      .prepare(`SELECT * FROM prices_daily WHERE asset_id = ? ORDER BY date ${order} ${limitSql}`)
      .all(assetId) as unknown as PriceBar[];
  }
  return db
    .prepare(
      `SELECT asset_id, date, open, high, low, close, adj_close, volume
       FROM bars_tf WHERE asset_id = ? AND timeframe = ? ORDER BY date ${order} ${limitSql}`
    )
    .all(assetId, timeframe) as unknown as PriceBar[];
}

export function upsertIndicators(rows: IndicatorRow[], timeframe: Timeframe = '1d'): number {
  if (rows.length === 0) return 0;
  const db = getDb();

  if (timeframe === '1d') {
    const stmt = db.prepare(`
      INSERT INTO indicators_daily (
        asset_id, date, sma_20, sma_50, sma_200, ema_12, ema_26,
        rsi_14, atr_14, adx_14, macd, macd_signal, bb_width, vol_ratio_20,
        ret_3m, ret_6m, ret_12m, rel_strength, pct_from_52w_high, dollar_vol_20
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, date) DO UPDATE SET
        sma_20 = excluded.sma_20,
        sma_50 = excluded.sma_50,
        sma_200 = excluded.sma_200,
        ema_12 = excluded.ema_12,
        ema_26 = excluded.ema_26,
        rsi_14 = excluded.rsi_14,
        atr_14 = excluded.atr_14,
        adx_14 = excluded.adx_14,
        macd = excluded.macd,
        macd_signal = excluded.macd_signal,
        bb_width = excluded.bb_width,
        vol_ratio_20 = excluded.vol_ratio_20,
        ret_3m = excluded.ret_3m,
        ret_6m = excluded.ret_6m,
        ret_12m = excluded.ret_12m,
        rel_strength = excluded.rel_strength,
        pct_from_52w_high = excluded.pct_from_52w_high,
        dollar_vol_20 = excluded.dollar_vol_20
    `);

    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const r of rows) {
        stmt.run(
          r.asset_id, r.date, r.sma_20, r.sma_50, r.sma_200, r.ema_12, r.ema_26,
          r.rsi_14, r.atr_14, r.adx_14, r.macd, r.macd_signal, r.bb_width, r.vol_ratio_20,
          r.ret_3m, r.ret_6m, r.ret_12m, r.rel_strength, r.pct_from_52w_high, r.dollar_vol_20
        );
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    return rows.length;
  }

  const stmt = db.prepare(`
    INSERT INTO indicators_tf (
      asset_id, timeframe, date, sma_20, sma_50, sma_200, ema_12, ema_26,
      rsi_14, atr_14, adx_14, macd, macd_signal, bb_width, vol_ratio_20,
      ret_3m, ret_6m, ret_12m, rel_strength, pct_from_52w_high, dollar_vol_20
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, timeframe, date) DO UPDATE SET
      sma_20 = excluded.sma_20,
      sma_50 = excluded.sma_50,
      sma_200 = excluded.sma_200,
      ema_12 = excluded.ema_12,
      ema_26 = excluded.ema_26,
      rsi_14 = excluded.rsi_14,
      atr_14 = excluded.atr_14,
      adx_14 = excluded.adx_14,
      macd = excluded.macd,
      macd_signal = excluded.macd_signal,
      bb_width = excluded.bb_width,
      vol_ratio_20 = excluded.vol_ratio_20,
      ret_3m = excluded.ret_3m,
      ret_6m = excluded.ret_6m,
      ret_12m = excluded.ret_12m,
      rel_strength = excluded.rel_strength,
      pct_from_52w_high = excluded.pct_from_52w_high,
      dollar_vol_20 = excluded.dollar_vol_20
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const r of rows) {
      stmt.run(
        r.asset_id, timeframe, r.date, r.sma_20, r.sma_50, r.sma_200, r.ema_12, r.ema_26,
        r.rsi_14, r.atr_14, r.adx_14, r.macd, r.macd_signal, r.bb_width, r.vol_ratio_20,
        r.ret_3m, r.ret_6m, r.ret_12m, r.rel_strength, r.pct_from_52w_high, r.dollar_vol_20
      );
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return rows.length;
}

export function upsertAssetFreshness(
  assetId: number,
  timeframe: Timeframe,
  lastBarTime: string,
  marketTime: string | null,
  fetchedAt: string,
  barCount: number
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO asset_freshness (asset_id, timeframe, last_bar_time, market_time, fetched_at, bar_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, timeframe) DO UPDATE SET
      last_bar_time = excluded.last_bar_time,
      market_time = excluded.market_time,
      fetched_at = excluded.fetched_at,
      bar_count = excluded.bar_count
  `).run(assetId, timeframe, lastBarTime, marketTime, fetchedAt, barCount);
}
