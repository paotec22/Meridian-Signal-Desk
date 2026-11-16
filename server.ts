import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { analyzeSignalWithGemini } from './src/engine/ai.ts';
import { runBacktest } from './src/engine/backtest.ts';
import { loadConfig, updateConfig } from './src/engine/config.ts';
import { getDb, upsertAsset } from './src/engine/db.ts';
import { recomputeAllIndicators } from './src/engine/indicators.ts';
import { ingestAssets } from './src/engine/ingestion.ts';
import { evaluateSignalOutcomes } from './src/engine/outcomes.ts';
import { ensureInitialDataReady, isPipelineRunning, runDailyPipeline } from './src/engine/pipeline.ts';
import { formatMorningDigest, sendTelegramDigest } from './src/engine/reporting.ts';
import { computeCorrelationMatrix } from './src/engine/risk.ts';
import { generateDailySignals, getMarketRegime } from './src/engine/signals.ts';
import type { AssetClass, AssetRow, IndicatorRow, PipelineRunRow, SignalRecord } from './src/engine/types.ts';
import { getActiveAssets, isExcludedCryptoToken, normalizeYahooTicker, syncUniverse } from './src/engine/universe.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json({ limit: '2mb' }));

  // Initialize DB & universe on startup, kick off initial ingestion in background if empty
  getDb();
  syncUniverse();
  ensureInitialDataReady().catch((err) => {
    console.error('Initial pipeline bootstrap error:', err);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, pipelineRunning: isPipelineRunning() });
  });

  app.get('/api/dashboard', (req, res) => {
    try {
      const db = getDb();
      const cfg = loadConfig();
      const equity = Number(req.query.equity ?? cfg.risk.default_account_equity);
      const riskPct = Number(req.query.riskPct ?? cfg.risk.default_risk_pct);

      const barCount = db.prepare('SELECT COUNT(*) as cnt FROM prices_daily').get() as { cnt: number };
      const lastRun = db
        .prepare('SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 1')
        .get() as unknown as PipelineRunRow | undefined;

      if (barCount.cnt === 0) {
        return res.json({
          bootstrapping: true,
          pipelineRunning: isPipelineRunning(),
          lastRun: lastRun ?? null,
          asOfDate: null,
          regime: null,
          signals: [],
          correlationMatrix: { symbols: [], matrix: [] },
          config: cfg,
          digestText: '',
        });
      }

      const { signals, regime, asOfDate } = generateDailySignals(
        Number.isFinite(equity) && equity > 0 ? equity : cfg.risk.default_account_equity,
        Number.isFinite(riskPct) && riskPct > 0 ? riskPct : cfg.risk.default_risk_pct
      );

      const actionable = signals.filter((s) => s.direction !== 'avoid');
      const correlationMatrix = computeCorrelationMatrix(
        actionable.length > 0 ? actionable : signals,
        cfg.risk.correlation_window_days
      );
      const digestText = formatMorningDigest(asOfDate, regime, signals);

      res.json({
        bootstrapping: false,
        pipelineRunning: isPipelineRunning(),
        lastRun: lastRun ?? null,
        asOfDate,
        regime,
        signals,
        correlationMatrix,
        config: cfg,
        digestText,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load dashboard' });
    }
  });

  app.post('/api/pipeline/run', async (req, res) => {
    try {
      const rangeYears = Number(req.body?.rangeYears ?? 2);
      const run = await runDailyPipeline(Number.isFinite(rangeYears) ? rangeYears : 2);
      res.json({ run });
    } catch (err) {
      const status = isPipelineRunning() ? 409 : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Pipeline run failed' });
    }
  });

  app.get('/api/pipeline/runs', (_req, res) => {
    const db = getDb();
    const runs = db
      .prepare('SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 15')
      .all() as unknown as PipelineRunRow[];
    res.json({ runs, pipelineRunning: isPipelineRunning() });
  });

  app.post('/api/assets', async (req, res) => {
    try {
      const rawSymbol = String(req.body?.symbol ?? '').trim();
      const name = String(req.body?.name ?? rawSymbol).trim();
      const assetClass = String(req.body?.asset_class ?? 'stock') as AssetClass;
      const sector = String(req.body?.sector ?? 'Custom').trim();

      if (!rawSymbol) {
        return res.status(400).json({ error: 'Symbol is required' });
      }
      const symbol = assetClass === 'stock' ? normalizeYahooTicker(rawSymbol) : rawSymbol.toUpperCase();
      if (assetClass === 'crypto' && isExcludedCryptoToken(symbol)) {
        return res.status(400).json({ error: 'Stablecoins and wrapped tokens are excluded by policy.' });
      }

      const source = assetClass === 'crypto' ? 'crypto' : 'yahoo';
      const asset = upsertAsset(symbol, name || symbol, assetClass, sector || 'Custom', source, 1);
      const result = await ingestAssets([asset], 2);
      if (result.errors.length > 0) {
        return res.status(400).json({ error: result.errors[0] });
      }
      const allAssets = getActiveAssets();
      recomputeAllIndicators(allAssets);
      const { signals } = generateDailySignals();
      const addedSignal = signals.find((s) => s.symbol === symbol) ?? null;

      res.json({ asset, barsInserted: result.barsInserted, signal: addedSignal });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add symbol' });
    }
  });

  app.get('/api/assets/:symbol/chart', (req, res) => {
    try {
      const db = getDb();
      const symbol = decodeURIComponent(req.params.symbol);
      const asset = db.prepare('SELECT * FROM assets WHERE symbol = ?').get(symbol) as unknown as
        | AssetRow
        | undefined;
      if (!asset) {
        return res.status(404).json({ error: `Asset ${symbol} not found` });
      }

      const limit = Math.min(365, Math.max(60, Number(req.query.days ?? 160)));
      const rows = db
        .prepare(
          `SELECT p.date, p.open, p.high, p.low, p.close, p.adj_close, p.volume,
                  i.sma_20, i.sma_50, i.sma_200, i.rsi_14, i.atr_14, i.adx_14,
                  i.macd, i.macd_signal, i.bb_width, i.vol_ratio_20, i.rel_strength,
                  i.ret_3m, i.ret_6m, i.pct_from_52w_high, i.dollar_vol_20
           FROM prices_daily p
           LEFT JOIN indicators_daily i ON i.asset_id = p.asset_id AND i.date = p.date
           WHERE p.asset_id = ?
           ORDER BY p.date DESC
           LIMIT ?`
        )
        .all(asset.id, limit) as Array<Record<string, unknown>>;

      const latestSignal = db
        .prepare('SELECT * FROM signals WHERE asset_id = ? ORDER BY date DESC LIMIT 1')
        .get(asset.id) as Record<string, unknown> | undefined;

      res.json({
        asset,
        series: rows.reverse(),
        signal: latestSignal
          ? {
              ...latestSignal,
              reasons: JSON.parse(String(latestSignal.reasons_json ?? '[]')),
            }
          : null,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load chart' });
    }
  });

  app.get('/api/scanner', (_req, res) => {
    try {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT a.id, a.symbol, a.name, a.asset_class, a.sector,
                  s.date, s.direction, s.long_score, s.short_score, s.score, s.close,
                  s.entry_low, s.entry_high, s.stop_loss, s.take_profit, s.risk_reward, s.position_pct,
                  i.rsi_14, i.atr_14, i.adx_14, i.vol_ratio_20, i.ret_3m, i.ret_6m,
                  i.rel_strength, i.pct_from_52w_high, i.dollar_vol_20
           FROM assets a
           JOIN signals s ON s.asset_id = a.id
           JOIN (
             SELECT asset_id, MAX(date) as max_date FROM signals GROUP BY asset_id
           ) latest ON latest.asset_id = s.asset_id AND latest.max_date = s.date
           LEFT JOIN indicators_daily i ON i.asset_id = a.id AND i.date = s.date
           WHERE a.active = 1 AND a.asset_class != 'benchmark'
           ORDER BY s.score DESC`
        )
        .all();
      res.json({ rows });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load scanner' });
    }
  });

  app.get('/api/backtest/latest', (_req, res) => {
    try {
      const db = getDb();
      const barCount = db.prepare('SELECT COUNT(*) as cnt FROM prices_daily').get() as { cnt: number };
      if (barCount.cnt === 0) {
        return res.json({ ready: false });
      }
      const cached = db
        .prepare('SELECT * FROM backtest_runs ORDER BY id DESC LIMIT 1')
        .get() as
        | {
            created_at: string;
            params_json: string;
            summary_json: string;
            equity_curve_json: string;
            trades_json: string;
          }
        | undefined;

      if (cached) {
        return res.json({
          ready: true,
          createdAt: cached.created_at,
          params: JSON.parse(cached.params_json),
          summary: JSON.parse(cached.summary_json),
          equityCurve: JSON.parse(cached.equity_curve_json),
          trades: JSON.parse(cached.trades_json),
        });
      }

      const fresh = runBacktest();
      res.json({
        ready: true,
        createdAt: new Date().toISOString(),
        params: {},
        ...fresh,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Backtest failed' });
    }
  });

  app.post('/api/backtest/run', (req, res) => {
    try {
      const params = {
        scoreThreshold: req.body?.scoreThreshold != null ? Number(req.body.scoreThreshold) : undefined,
        stopAtrMult: req.body?.stopAtrMult != null ? Number(req.body.stopAtrMult) : undefined,
        targetRMultiple: req.body?.targetRMultiple != null ? Number(req.body.targetRMultiple) : undefined,
        timeStopDays: req.body?.timeStopDays != null ? Number(req.body.timeStopDays) : undefined,
        assetClassFilter: req.body?.assetClassFilter ?? 'all',
      };
      const result = runBacktest(params);
      res.json({
        ready: true,
        createdAt: new Date().toISOString(),
        params,
        ...result,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Backtest failed' });
    }
  });

  app.get('/api/outcomes', (_req, res) => {
    try {
      const db = getDb();
      const barCount = db.prepare('SELECT COUNT(*) as cnt FROM prices_daily').get() as { cnt: number };
      if (barCount.cnt === 0) {
        return res.json({ outcomes: [], stats: null });
      }
      const outcomes = evaluateSignalOutcomes();
      const closed = outcomes.filter((o) => o.status === 'closed');
      const wins = closed.filter((o) => o.return_pct > 0);
      const losses = closed.filter((o) => o.return_pct <= 0);
      const grossWin = wins.reduce((s, o) => s + o.return_pct, 0);
      const grossLoss = Math.abs(losses.reduce((s, o) => s + o.return_pct, 0));

      const stats = {
        totalSignals: outcomes.length,
        closedCount: closed.length,
        openCount: outcomes.length - closed.length,
        winRatePct: closed.length > 0 ? Number(((wins.length / closed.length) * 100).toFixed(1)) : 0,
        avgReturnPct:
          closed.length > 0
            ? Number((closed.reduce((s, o) => s + o.return_pct, 0) / closed.length).toFixed(2))
            : 0,
        avgRMultiple:
          closed.length > 0
            ? Number((closed.reduce((s, o) => s + o.r_multiple, 0) / closed.length).toFixed(2))
            : 0,
        profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 3.0 : 0,
        avgHoldingDays:
          closed.length > 0
            ? Number((closed.reduce((s, o) => s + o.holding_days, 0) / closed.length).toFixed(1))
            : 0,
      };
      res.json({ outcomes, stats });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to evaluate outcomes' });
    }
  });

  app.get('/api/config', (_req, res) => {
    res.json({ config: loadConfig() });
  });

  app.put('/api/config', (req, res) => {
    try {
      const next = updateConfig(req.body ?? {});
      const db = getDb();
      const barCount = db.prepare('SELECT COUNT(*) as cnt FROM prices_daily').get() as { cnt: number };
      if (barCount.cnt > 0) {
        generateDailySignals();
      }
      res.json({ config: next });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid configuration' });
    }
  });

  app.post('/api/digest/telegram', async (req, res) => {
    try {
      const text = String(req.body?.digestText ?? '').trim();
      if (!text) return res.status(400).json({ error: 'Digest text is required' });
      const result = await sendTelegramDigest(text);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Telegram delivery failed' });
    }
  });

  app.post('/api/ai/analyze-signal', async (req, res) => {
    try {
      const symbol = String(req.body?.symbol ?? '').trim();
      if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
      const db = getDb();
      const asset = db.prepare('SELECT * FROM assets WHERE symbol = ?').get(symbol) as unknown as
        | AssetRow
        | undefined;
      if (!asset) return res.status(404).json({ error: `Asset ${symbol} not found` });

      const sigRow = db
        .prepare('SELECT * FROM signals WHERE asset_id = ? ORDER BY date DESC LIMIT 1')
        .get(asset.id) as Record<string, unknown> | undefined;
      if (!sigRow) return res.status(404).json({ error: `No signal found for ${symbol}` });

      const ind = db
        .prepare('SELECT * FROM indicators_daily WHERE asset_id = ? AND date = ?')
        .get(asset.id, String(sigRow.date)) as unknown as IndicatorRow | undefined;

      const signal: SignalRecord = {
        date: String(sigRow.date),
        asset_id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        asset_class: asset.asset_class,
        sector: asset.sector,
        direction: sigRow.direction as SignalRecord['direction'],
        long_score: Number(sigRow.long_score),
        short_score: Number(sigRow.short_score),
        score: Number(sigRow.score),
        close: Number(sigRow.close),
        entry_low: Number(sigRow.entry_low),
        entry_high: Number(sigRow.entry_high),
        stop_loss: Number(sigRow.stop_loss),
        take_profit: Number(sigRow.take_profit),
        risk_reward: Number(sigRow.risk_reward),
        position_pct: Number(sigRow.position_pct),
        reasons: JSON.parse(String(sigRow.reasons_json ?? '[]')),
        regime: String(sigRow.regime),
      };

      const regime = getMarketRegime();
      const brief = await analyzeSignalWithGemini(signal, regime, {
        rsi_14: ind?.rsi_14 ?? null,
        adx_14: ind?.adx_14 ?? null,
        atr_14: ind?.atr_14 ?? null,
        ret_3m: ind?.ret_3m ?? null,
      });

      res.json({ brief });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'AI analysis failed' });
    }
  });

  // Vite dev middleware or production static files
  const distPath = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distPath);

  if (isProd) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian Signal Desk listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
