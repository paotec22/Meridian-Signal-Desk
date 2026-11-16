import crypto from 'node:crypto';
import { getDb } from './db.ts';
import { recomputeAllIndicators } from './indicators.ts';
import { ingestAssets } from './ingestion.ts';
import { evaluateSignalOutcomes } from './outcomes.ts';
import { generateDailySignals } from './signals.ts';
import { getActiveAssets, syncUniverse } from './universe.ts';
import type { PipelineRunRow, Timeframe } from './types.ts';

let pipelineRunning = false;

export function isPipelineRunning(): boolean {
  return pipelineRunning;
}

export async function runDailyPipeline(
  rangeYears = 2,
  timeframe: Timeframe = '1d'
): Promise<PipelineRunRow> {
  if (pipelineRunning) {
    throw new Error('Pipeline run is already in progress');
  }
  pipelineRunning = true;
  const db = getDb();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  db.prepare(
    'INSERT INTO pipeline_runs (run_id, started_at, status, assets_processed, signals_generated) VALUES (?, ?, ?, 0, 0)'
  ).run(runId, startedAt, 'running');

  try {
    syncUniverse();
    const assets = getActiveAssets();
    const ingestion = await ingestAssets(assets, rangeYears, timeframe);
    if (timeframe === '1h' || timeframe === '4h') {
      recomputeAllIndicators(assets, '1h');
      recomputeAllIndicators(assets, '4h');
    } else {
      recomputeAllIndicators(assets, timeframe);
    }
    const { signals } = generateDailySignals(undefined, undefined, timeframe);
    if (timeframe === '1d') {
      evaluateSignalOutcomes();
    }

    const failRate = assets.length > 0 ? ingestion.errors.length / assets.length : 0;
    const status =
      ingestion.processed === 0
        ? 'failed'
        : failRate > 0.05 || ingestion.errors.length > 0
        ? 'partial'
        : 'completed';
    const finishedAt = new Date().toISOString();

    db.prepare(
      `UPDATE pipeline_runs
       SET finished_at = ?, status = ?, assets_processed = ?, signals_generated = ?, errors_json = ?, warnings_json = ?
       WHERE run_id = ?`
    ).run(
      finishedAt,
      status,
      ingestion.processed,
      signals.length,
      JSON.stringify(ingestion.errors),
      JSON.stringify(ingestion.warnings),
      runId
    );

    return db.prepare('SELECT * FROM pipeline_runs WHERE run_id = ?').get(runId) as unknown as PipelineRunRow;
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(
      'UPDATE pipeline_runs SET finished_at = ?, status = ?, errors_json = ? WHERE run_id = ?'
    ).run(finishedAt, 'failed', JSON.stringify([msg]), runId);
    throw err;
  } finally {
    pipelineRunning = false;
  }
}

export function hasTimeframeData(timeframe: Timeframe): boolean {
  const db = getDb();
  if (timeframe === '1d') {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM prices_daily').get() as { cnt: number };
    return row.cnt > 0;
  }
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM bars_tf WHERE timeframe = ?')
    .get(timeframe) as { cnt: number };
  return row.cnt > 0;
}

export async function ensureInitialDataReady(): Promise<void> {
  syncUniverse();
  if (!hasTimeframeData('1d')) {
    await runDailyPipeline(2, '1d');
  }
}
