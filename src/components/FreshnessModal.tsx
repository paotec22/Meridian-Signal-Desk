import { CheckCircle2, Clock, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FreshnessSummary, PipelineRunRow, Timeframe } from '../types';

interface Props {
  timeframe: Timeframe;
  onClose: () => void;
  onRefreshNow: () => Promise<void>;
  refreshing: boolean;
}

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })} (${d.toISOString().slice(11, 16)} UTC)`;
}

export function FreshnessModal({ timeframe, onClose, onRefreshNow, refreshing }: Props) {
  const [freshness, setFreshness] = useState<FreshnessSummary | null>(null);
  const [runs, setRuns] = useState<PipelineRunRow[]>([]);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAudit = () => {
    setLoading(true);
    Promise.all([
      fetch(`/api/freshness?timeframe=${timeframe}`).then((r) => r.json()),
      fetch('/api/pipeline/runs').then((r) => r.json()),
    ])
      .then(([fData, rData]) => {
        setFreshness(fData.freshness ?? null);
        setServerTime(fData.serverTime ?? null);
        setRuns(rData.runs ?? []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAudit();
  }, [timeframe]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-[1px]">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 font-display">
              Data Currency &amp; Timeframe Audit ({timeframe.toUpperCase()})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verify exact candle timestamps, exchange market times, and ingestion history.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close audit"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto text-xs">
          {loading || !freshness ? (
            <div className="py-8 text-center text-slate-500">Checking database timestamps...</div>
          ) : (
            <>
              <div className="p-4 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                    {freshness.status === 'Current' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    )}
                    <span>Status: {freshness.status}</span>
                  </div>
                  <div className="text-slate-600 dark:text-slate-400">{freshness.statusReason}</div>
                  <div className="text-slate-500 font-mono tabular-nums">
                    Server Clock: {fmtIso(serverTime)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    await onRefreshNow();
                    loadAudit();
                  }}
                  disabled={refreshing}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60 font-medium whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? `Syncing ${timeframe.toUpperCase()}...` : `Sync ${timeframe.toUpperCase()} Now`}
                </button>
              </div>

              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  Latest Market Bars by Asset Class
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left bg-slate-50 dark:bg-slate-950">
                        <th className="px-3 py-2 font-medium">Asset Class</th>
                        <th className="px-3 py-2 font-medium text-right">Symbols</th>
                        <th className="px-3 py-2 font-medium">Latest Candle</th>
                        <th className="px-3 py-2 font-medium">Exchange Quote Time</th>
                        <th className="px-3 py-2 font-medium">Last Fetched</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                      {Object.entries(freshness.byClass).map(([cls, info]) => (
                        <tr key={cls}>
                          <td className="px-3 py-2 font-sans capitalize font-medium text-slate-900 dark:text-slate-100">
                            {cls}
                          </td>
                          <td className="px-3 py-2 text-right">{info.assetsCount}</td>
                          <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                            {info.latestBarTime ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {fmtIso(info.latestMarketTime)}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {fmtIso(info.lastFetchedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Note: Crypto trades 24/7 and Futures trade ~23h/day, while US Equities update during regular market hours (09:30–16:00 ET).
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  Recent Pipeline Runs
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left bg-slate-50 dark:bg-slate-950">
                        <th className="px-3 py-2 font-medium">Finished</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium text-right">Assets</th>
                        <th className="px-3 py-2 font-medium text-right">Signals</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                      {runs.slice(0, 6).map((r) => (
                        <tr key={r.run_id}>
                          <td className="px-3 py-2">{fmtIso(r.finished_at ?? r.started_at)}</td>
                          <td className="px-3 py-2 font-sans capitalize">{r.status}</td>
                          <td className="px-3 py-2 text-right">{r.assets_processed}</td>
                          <td className="px-3 py-2 text-right">{r.signals_generated}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
