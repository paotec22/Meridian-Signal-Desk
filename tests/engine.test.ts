import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/engine/config.ts';
import { computeAssetIndicators } from '../src/engine/indicators.ts';
import { validateBars } from '../src/engine/ingestion.ts';
import { computeRiskLevels, pearsonCorrelation } from '../src/engine/risk.ts';
import { scoreAssetRow } from '../src/engine/signals.ts';
import type { AssetRow, IndicatorRow, PriceBar, RegimeStatus } from '../src/engine/types.ts';
import { isExcludedCryptoToken, normalizeYahooTicker } from '../src/engine/universe.ts';

test('Phase 2: Universe normalizes Yahoo tickers and excludes stablecoins/wrapped tokens', () => {
  assert.equal(normalizeYahooTicker('BRK.B'), 'BRK-B');
  assert.equal(isExcludedCryptoToken('USDT-USD'), true);
  assert.equal(isExcludedCryptoToken('USDC-USD'), true);
  assert.equal(isExcludedCryptoToken('WBTC-USD'), true);
  assert.equal(isExcludedCryptoToken('BTC-USD'), false);
  assert.equal(isExcludedCryptoToken('SOL-USD'), false);
});

test('Phase 3: OHLCV validator rejects invalid bars, duplicates, and flags >40% jumps', () => {
  const asset: AssetRow = {
    id: 1,
    symbol: 'TEST',
    name: 'Test Asset',
    asset_class: 'stock',
    sector: 'Tech',
    source: 'yahoo',
    active: 1,
    added_at: '2026-01-01',
  };
  const raw: PriceBar[] = [
    { asset_id: 1, date: '2026-01-02', open: 100, high: 105, low: 99, close: 102, adj_close: 102, volume: 1000 },
    { asset_id: 1, date: '2026-01-02', open: 100, high: 105, low: 99, close: 102, adj_close: 102, volume: 1000 }, // duplicate
    { asset_id: 1, date: '2026-01-03', open: 100, high: 95, low: 101, close: 98, adj_close: 98, volume: 1000 }, // high < low
    { asset_id: 1, date: '2026-01-04', open: -5, high: 10, low: 5, close: 8, adj_close: 8, volume: 1000 }, // negative price
    { asset_id: 1, date: '2026-01-05', open: 150, high: 160, low: 148, close: 155, adj_close: 155, volume: 1000 }, // >40% jump
  ];
  const res = validateBars(asset, raw);
  assert.equal(res.validBars.length, 2);
  assert.equal(res.rejectedCount, 3);
  assert.equal(res.warnings.length >= 1, true);
});

test('Phase 4: Indicator engine produces non-NaN SMA/RSI/ATR after warm-up period', () => {
  const asset: AssetRow = {
    id: 1,
    symbol: 'AAPL',
    name: 'Apple',
    asset_class: 'stock',
    sector: 'Tech',
    source: 'yahoo',
    active: 1,
    added_at: '2026-01-01',
  };
  const bars: PriceBar[] = [];
  const bench = new Map<string, number>();
  for (let i = 0; i < 240; i++) {
    const dt = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    const base = 100 + i * 0.25 + Math.sin(i / 5) * 2;
    bars.push({
      asset_id: 1,
      date: dt,
      open: base - 0.5,
      high: base + 1.2,
      low: base - 1.1,
      close: base,
      adj_close: base,
      volume: 1_000_000 + i * 1000,
    });
    bench.set(dt, 4000 + i * 2);
  }
  const rows = computeAssetIndicators(asset, bars, bench);
  assert.equal(rows.length, 240);
  const last = rows[239];
  assert.ok(last.sma_200 != null && last.sma_200 > 100);
  assert.ok(last.rsi_14 != null && last.rsi_14 > 0 && last.rsi_14 <= 100);
  assert.ok(last.atr_14 != null && last.atr_14 > 0);
  assert.ok(last.adx_14 != null && last.adx_14 >= 0);
});

test('Phase 5: Signal scoring matches hand calculation and respects bearish regime multiplier', () => {
  const cfg = loadConfig();
  const ind: IndicatorRow = {
    asset_id: 1,
    date: '2026-11-12',
    sma_20: 145,
    sma_50: 140,
    sma_200: 120,
    ema_12: 148,
    ema_26: 142,
    rsi_14: 61,
    atr_14: 3.5,
    adx_14: 28,
    macd: 2.1,
    macd_signal: 1.4,
    bb_width: 0.08,
    vol_ratio_20: 1.35,
    ret_3m: 0.14,
    ret_6m: 0.24,
    ret_12m: 0.4,
    rel_strength: 0.08,
    pct_from_52w_high: -0.02,
    dollar_vol_20: 50_000_000,
  };
  const bullRegime: RegimeStatus = {
    sp500Close: 6000,
    sp500Sma200: 5500,
    sp500Bullish: true,
    btcClose: 90000,
    btcSma200: 70000,
    btcBullish: true,
    dxyClose: 104,
    dxySma50: 103,
    summary: 'Bullish',
  };
  const bull = scoreAssetRow('stock', 150, 148, ind, bullRegime, cfg);
  assert.equal(bull.longScore, 100);
  assert.equal(bull.direction, 'long');

  const bearRegime = { ...bullRegime, sp500Bullish: false };
  const bear = scoreAssetRow('stock', 150, 148, ind, bearRegime, cfg);
  assert.equal(bear.longScore, 80); // 100 * 0.80
});

test('Phase 6: Risk formula computes exact shares, stop-loss, and correlation', () => {
  const cfg = loadConfig();
  // Entry 100, ATR 2, stop = 100 - 2*2 = 96, risk 1% of $10,000 = $100 -> 25 shares ($2500 -> >15% cap of $1500 -> capped at 15 shares)
  const levels = computeRiskLevels('long', 100, 2, [], 10000, 1.0, cfg);
  assert.equal(levels.stopLoss, 96);
  assert.equal(levels.entryLow, 100);
  assert.equal(levels.entryHigh, 101);
  assert.equal(levels.positionPct, 15);
  assert.equal(levels.shares, 15);

  const corr = pearsonCorrelation([0.01, 0.02, -0.01, 0.03, 0.01, -0.02, 0.04, 0.01, 0.02, -0.01], [0.01, 0.02, -0.01, 0.03, 0.01, -0.02, 0.04, 0.01, 0.02, -0.01]);
  assert.ok(Math.abs(corr - 1) < 1e-6);
});
