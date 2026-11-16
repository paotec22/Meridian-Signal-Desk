import { Loader2, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BacktestResult } from '../types';
import { EquityCurveChart } from './EquityCurveChart';

export function BacktestView() {
  const [data, setData] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scoreThreshold, setScoreThreshold] = useState(70);
  const [stopAtrMult, setStopAtrMult] = useState(2.0);
  const [targetRMultiple, setTargetRMultiple] = useState(2.0);
  const [timeStopDays, setTimeStopDays] = useState(15);
  const [assetClassFilter, setAssetClassFilter] = useState<'all' | 'stock' | 'commodity' | 'crypto'>('all');

  useEffect(() => {
    fetch('/api/backtest/latest')
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error);
        setData(res);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load backtest'))
      .finally(() => setLoading(false));
  }, []);

  const handleRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoreThreshold,
          stopAtrMult,
          targetRMultiple,
          timeStopDays,
          assetClassFilter,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Backtest failed');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Running walk-forward backtest simulation...
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-sm text-red-600">{error}</div>;
  }

  const s = data?.summary;

  return (
    <div className="space-y-6">
      {/* Simulation Controls */}
      <form
        onSubmit={handleRunBacktest}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-wrap items-end gap-4"
      >
        <label className="text-xs space-y-1">
          <span className="text-slate-500 dark:text-slate-400 block">Min Score</span>
          <input
            type="number"
            min={50}
            max={95}
            value={scoreThreshold}
            onChange={(e) => setScoreThreshold(Number(e.target.value))}
            className="w-24 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-slate-500 dark:text-slate-400 block">Stop ATR Mult</span>
          <input
            type="number"
            step="0.2"
            min={0.8}
            max={4}
            value={stopAtrMult}
            onChange={(e) => setStopAtrMult(Number(e.target.value))}
            className="w-24 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-slate-500 dark:text-slate-400 block">Target R:R</span>
          <input
            type="number"
            step="0.2"
            min={1.0}
            max={5}
            value={targetRMultiple}
            onChange={(e) => setTargetRMultiple(Number(e.target.value))}
            className="w-24 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-slate-500 dark:text-slate-400 block">Time Stop (Days)</span>
          <input
            type="number"
            min={5}
            max={45}
            value={timeStopDays}
            onChange={(e) => setTimeStopDays(Number(e.target.value))}
            className="w-24 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-slate-500 dark:text-slate-400 block">Asset Class</span>
          <select
            value={assetClassFilter}
            onChange={(e) => setAssetClassFilter(e.target.value as typeof assetClassFilter)}
            className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
          >
            <option value="all">All Classes</option>
            <option value="stock">Stocks</option>
            <option value="commodity">Commodities</option>
            <option value="crypto">Crypto</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={running}
          className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {running ? 'Simulating...' : 'Run Backtest'}
        </button>
      </form>

      {s && (
        <>
          {/* Summary KPI Grid */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Strategy Return</div>
              <div
                className={`mt-1 text-lg font-semibold font-mono tabular-nums ${
                  s.totalReturnPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                }`}
              >
                {s.totalReturnPct >= 0 ? '+' : ''}
                {s.totalReturnPct}%
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">S&amp;P 500 Benchmark</div>
              <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {s.benchmarkReturnPct >= 0 ? '+' : ''}
                {s.benchmarkReturnPct}%
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Win Rate</div>
              <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {s.winRatePct}%
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Profit Factor</div>
              <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {s.profitFactor.toFixed(2)}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Sharpe Ratio</div>
              <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {s.sharpeRatio.toFixed(2)}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Max Drawdown</div>
              <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-red-700 dark:text-red-400">
                -{s.maxDrawdownPct}%
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Total Trades</div>
              <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {s.totalTrades}
              </div>
            </div>
          </div>

          {/* Equity Curve */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Out-of-Sample Equity Curve (Next-Day Open Fills, Conservative Stop-First)
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                CAGR {s.cagrPct}% · Avg Hold {s.avgHoldingDays}d · Avg Win +{s.avgWinPct}% / Loss {s.avgLossPct}%
              </span>
            </div>
            <EquityCurveChart data={data?.equityCurve ?? []} />
          </div>

          {/* Walk-Forward, Sensitivity & Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Walk-Forward Splits &amp; Regime Breakdown
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left">
                    <th className="py-2 font-medium">Window</th>
                    <th className="py-2 font-medium">Period</th>
                    <th className="py-2 font-medium text-right">Trades</th>
                    <th className="py-2 font-medium text-right">Win %</th>
                    <th className="py-2 font-medium text-right">Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {s.walkForwardWindows.map((w) => (
                    <tr key={w.window}>
                      <td className="py-2 font-sans font-medium text-slate-900 dark:text-slate-100">{w.window}</td>
                      <td className="py-2 text-slate-500">{w.period}</td>
                      <td className="py-2 text-right">{w.trades}</td>
                      <td className="py-2 text-right">{w.winRatePct}%</td>
                      <td
                        className={`py-2 text-right ${
                          w.returnPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {w.returnPct >= 0 ? '+' : ''}
                        {w.returnPct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100 mb-1.5">By Asset Class</div>
                  {Object.entries(s.byAssetClass).map(([cls, m]) => (
                    <div key={cls} className="flex justify-between py-1 font-mono tabular-nums">
                      <span className="capitalize font-sans text-slate-600 dark:text-slate-400">{cls}</span>
                      <span>
                        {m.trades} tr · {m.winRatePct}% · {m.avgReturnPct >= 0 ? '+' : ''}
                        {m.avgReturnPct}%
                      </span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100 mb-1.5">By Market Regime</div>
                  {Object.entries(s.byRegime).map(([reg, m]) => (
                    <div key={reg} className="flex justify-between py-1 font-mono tabular-nums">
                      <span className="capitalize font-sans text-slate-600 dark:text-slate-400">{reg}</span>
                      <span>
                        {m.trades} tr · {m.winRatePct}% · {m.avgReturnPct >= 0 ? '+' : ''}
                        {m.avgReturnPct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Parameter Sensitivity (±20%) &amp; Integrity Check
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left">
                    <th className="py-2 font-medium">Perturbation</th>
                    <th className="py-2 font-medium text-right">Win %</th>
                    <th className="py-2 font-medium text-right">Sharpe</th>
                    <th className="py-2 font-medium text-right">Total Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {s.sensitivity.map((row) => (
                    <tr key={row.label}>
                      <td className="py-2 font-sans text-slate-900 dark:text-slate-100">{row.label}</td>
                      <td className="py-2 text-right">{row.winRatePct}%</td>
                      <td className="py-2 text-right">{row.sharpeRatio.toFixed(2)}</td>
                      <td
                        className={`py-2 text-right ${
                          row.totalReturnPct >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {row.totalReturnPct >= 0 ? '+' : ''}
                        {row.totalReturnPct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  Look-Ahead &amp; Shuffled-Signal Audit
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  {s.lookAheadIntegrity.note} Causal Return:{' '}
                  <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                    {s.lookAheadIntegrity.causalReturnPct}%
                  </span>{' '}
                  vs. Shuffled Dates:{' '}
                  <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                    {s.lookAheadIntegrity.shuffledReturnPct}%
                  </span>
                  . Known limitations: current-constituent survivorship bias and estimated transaction costs.
                </p>
              </div>
            </div>
          </div>

          {/* Simulated Trades Ledger */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Recent Simulated Trades (Net of Slippage &amp; Fees)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left">
                    <th className="px-4 py-2.5 font-medium">Symbol</th>
                    <th className="px-4 py-2.5 font-medium">Side</th>
                    <th className="px-4 py-2.5 font-medium">Entry Date</th>
                    <th className="px-4 py-2.5 font-medium">Exit Date</th>
                    <th className="px-4 py-2.5 font-medium text-right">Entry</th>
                    <th className="px-4 py-2.5 font-medium text-right">Exit</th>
                    <th className="px-4 py-2.5 font-medium">Reason</th>
                    <th className="px-4 py-2.5 font-medium text-right">Days</th>
                    <th className="px-4 py-2.5 font-medium text-right">Net Ret</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {(data?.trades ?? []).slice(0, 30).map((t, idx) => (
                    <tr key={`${t.symbol}-${t.entry_date}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">
                        {t.symbol} <span className="font-sans font-normal text-slate-400">· {t.asset_class}</span>
                      </td>
                      <td
                        className={`px-4 py-2 uppercase font-medium ${
                          t.direction === 'long' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {t.direction}
                      </td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{t.entry_date}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{t.exit_date}</td>
                      <td className="px-4 py-2 text-right">{t.entry_price}</td>
                      <td className="px-4 py-2 text-right">{t.exit_price}</td>
                      <td className="px-4 py-2 font-sans capitalize text-slate-600 dark:text-slate-300">
                        {t.exit_reason}
                      </td>
                      <td className="px-4 py-2 text-right">{t.holding_days}</td>
                      <td
                        className={`px-4 py-2 text-right font-medium ${
                          t.net_return_pct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {t.net_return_pct >= 0 ? '+' : ''}
                        {t.net_return_pct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
