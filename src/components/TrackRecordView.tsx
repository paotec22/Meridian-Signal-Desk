import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OutcomeStats, SignalOutcomeRow } from '../types';

export function TrackRecordView() {
  const [outcomes, setOutcomes] = useState<SignalOutcomeRow[]>([]);
  const [stats, setStats] = useState<OutcomeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'closed' | 'open'>('all');

  useEffect(() => {
    fetch('/api/outcomes')
      .then((r) => r.json())
      .then((data) => {
        setOutcomes(data.outcomes ?? []);
        setStats(data.stats ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Evaluating historical signals against subsequent bars...
      </div>
    );
  }

  const visible = outcomes.filter((o) => (statusFilter === 'all' ? true : o.status === statusFilter));

  return (
    <div className="space-y-6">
      {stats && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Tracked Signals</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {stats.totalSignals} <span className="text-xs font-normal text-slate-500">({stats.openCount} open)</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Closed Hit Rate</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {stats.winRatePct}%
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Avg Return</div>
            <div
              className={`mt-1 text-lg font-semibold font-mono tabular-nums ${
                stats.avgReturnPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
              }`}
            >
              {stats.avgReturnPct >= 0 ? '+' : ''}
              {stats.avgReturnPct}%
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Avg R-Multiple</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {stats.avgRMultiple >= 0 ? '+' : ''}
              {stats.avgRMultiple}R
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Profit Factor</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {stats.profitFactor.toFixed(2)}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Avg Hold Days</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {stats.avgHoldingDays}d
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Signal Outcome Ledger
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Every logged signal evaluated against T+1 open entry, ATR stop-loss, take-profit, and 15-day time stop.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
            {(['all', 'closed', 'open'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 text-xs font-medium rounded capitalize transition-colors ${
                  statusFilter === st
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left">
                <th className="px-4 py-2.5 font-medium">Signal Date</th>
                <th className="px-4 py-2.5 font-medium">Asset</th>
                <th className="px-4 py-2.5 font-medium">Side</th>
                <th className="px-4 py-2.5 font-medium text-right">Score</th>
                <th className="px-4 py-2.5 font-medium text-right">Entry (T+1)</th>
                <th className="px-4 py-2.5 font-medium text-right">Stop / Target</th>
                <th className="px-4 py-2.5 font-medium">Exit / Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Days</th>
                <th className="px-4 py-2.5 font-medium text-right">Return</th>
                <th className="px-4 py-2.5 font-medium text-right">R-Mult</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
              {visible.map((o) => (
                <tr key={o.signal_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{o.signal_date}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{o.symbol}</span>{' '}
                    <span className="font-sans text-slate-400">· {o.asset_class}</span>
                  </td>
                  <td
                    className={`px-4 py-2.5 uppercase font-medium ${
                      o.direction === 'long' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {o.direction}
                  </td>
                  <td className="px-4 py-2.5 text-right">{o.score}</td>
                  <td className="px-4 py-2.5 text-right">{o.entry_price}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">
                    {o.stop_loss} / {o.take_profit}
                  </td>
                  <td className="px-4 py-2.5 font-sans capitalize">
                    {o.status === 'open' ? (
                      <span className="text-blue-700 dark:text-blue-400 font-medium">Open (Live)</span>
                    ) : (
                      <span
                        className={
                          o.exit_reason === 'target'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : o.exit_reason === 'stop'
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-slate-600 dark:text-slate-300'
                        }
                      >
                        {o.exit_reason} @ {o.exit_price}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">{o.holding_days}</td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium ${
                      o.return_pct > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : o.return_pct < 0
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {o.return_pct > 0 ? '+' : ''}
                    {o.return_pct}%
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {o.r_multiple > 0 ? '+' : ''}
                    {o.r_multiple}R
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
