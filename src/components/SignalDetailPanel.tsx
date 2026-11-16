import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ChartSeriesPoint, SignalRecord, SignalResearchBrief } from '../types';
import { CandlestickChart } from './CandlestickChart';

interface Props {
  signal: SignalRecord;
  equity: number;
  riskPct: number;
  maxPositionPct: number;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

export function SignalDetailPanel({ signal, equity, riskPct, maxPositionPct }: Props) {
  const [series, setSeries] = useState<ChartSeriesPoint[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const [aiBrief, setAiBrief] = useState<SignalResearchBrief | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingChart(true);
    setChartError(null);
    setAiBrief(null);
    setAiError(null);

    fetch(`/api/assets/${encodeURIComponent(signal.symbol)}/chart?days=150`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data.error) throw new Error(data.error);
        setSeries(data.series ?? []);
      })
      .catch((err) => {
        if (!active) return;
        setChartError(err instanceof Error ? err.message : 'Failed to load chart');
      })
      .finally(() => {
        if (active) setLoadingChart(false);
      });

    return () => {
      active = false;
    };
  }, [signal.symbol]);

  const handleRunAiBrief = async () => {
    setLoadingAi(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai/analyze-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: signal.symbol }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'AI catalyst review failed');
      }
      setAiBrief(data.brief);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to run catalyst check');
    } finally {
      setLoadingAi(false);
    }
  };

  // Live position sizing calculation reflecting user's Equity & Risk % controls
  const riskPerUnit = Math.max(Math.abs(signal.close - signal.stop_loss), 1e-6);
  const dollarRiskTarget = equity * (riskPct / 100);
  const rawNotional = (dollarRiskTarget / riskPerUnit) * signal.close;
  const maxNotional = equity * (maxPositionPct / 100);
  const cappedNotional = Math.min(rawNotional, maxNotional);
  const units = signal.close > 0 ? cappedNotional / signal.close : 0;
  const actualDollarRisk = units * riskPerUnit;
  const actualAllocPct = equity > 0 ? (cappedNotional / equity) * 100 : 0;

  const latestBar = series[series.length - 1];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
      {/* Header Summary */}
      <div className="p-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="capitalize">{signal.asset_class}</span>
            <span aria-hidden="true">·</span>
            <span>{signal.sector}</span>
            <span aria-hidden="true">·</span>
            <span>As of {signal.date}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 font-display">
              {signal.symbol}
            </h2>
            <span className="text-sm text-slate-600 dark:text-slate-300">{signal.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-6 font-mono tabular-nums">
          <div className="text-right">
            <div className="text-xs text-slate-500 dark:text-slate-400 font-sans">Last Close</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              ${fmtPrice(signal.close)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 dark:text-slate-400 font-sans">Direction</div>
            <div
              className={`text-sm font-semibold inline-flex items-center gap-1 ${
                signal.direction === 'long'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : signal.direction === 'short'
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {signal.direction === 'long' && <TrendingUp className="w-4 h-4" />}
              {signal.direction === 'short' && <TrendingDown className="w-4 h-4" />}
              {signal.direction.toUpperCase()} ({signal.score}/100)
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Chart */}
      <div className="p-5">
        {loadingChart ? (
          <div className="h-72 flex items-center justify-center text-sm text-slate-500 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading price &amp; indicator history...
          </div>
        ) : chartError ? (
          <div className="h-72 flex items-center justify-center text-sm text-red-600">{chartError}</div>
        ) : (
          <CandlestickChart series={series} signal={signal} symbol={signal.symbol} />
        )}
      </div>

      {/* Trade Plan & Live Position Sizing */}
      <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Entry Zone</div>
          <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
            {fmtPrice(signal.entry_low)} – {fmtPrice(signal.entry_high)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Stop-Loss (2×ATR)</div>
          <div className="mt-1 text-sm font-mono tabular-nums font-medium text-red-700 dark:text-red-400">
            {fmtPrice(signal.stop_loss)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Take-Profit Target</div>
          <div className="mt-1 text-sm font-mono tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
            {fmtPrice(signal.take_profit)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Reward : Risk</div>
          <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
            {signal.risk_reward.toFixed(2)} : 1
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Suggested Units</div>
          <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
            {units >= 10 ? units.toFixed(1) : units.toFixed(3)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Position Allocation</div>
          <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
            ${cappedNotional.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({actualAllocPct.toFixed(1)}%)
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Planned Dollar Risk</div>
          <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
            ${actualDollarRisk.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">3M Rel. Strength</div>
          <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
            {latestBar?.rel_strength != null ? `${(latestBar.rel_strength * 100).toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Transparent Rule Reasons */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Rule Engine Breakdown
          </h3>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Long Score: {signal.long_score} · Short Score: {signal.short_score}
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            {signal.reasons.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-slate-400 select-none">•</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* AI Catalyst & Event Risk Check */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Catalyst &amp; Earnings Risk Review
            </h3>
            <button
              type="button"
              onClick={handleRunAiBrief}
              disabled={loadingAi}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              {loadingAi ? 'Checking Catalysts...' : aiBrief ? 'Refresh Catalyst Check' : 'Run Catalyst Check'}
            </button>
          </div>

          {!aiBrief && !loadingAi && !aiError && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Run a real-time search-grounded analyst check for upcoming earnings dates, macro events, and invalidation risks before entering.
            </p>
          )}

          {loadingAi && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reviewing recent news, earnings calendar, and macro alignment...
            </div>
          )}

          {aiError && (
            <div className="mt-3 text-xs text-red-600 dark:text-red-400">{aiError}</div>
          )}

          {aiBrief && (
            <div className="mt-3 space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
              {aiBrief.notice && (
                <p className="px-3 py-2 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 leading-relaxed">
                  {aiBrief.notice}
                </p>
              )}
              <div className="flex items-center gap-1.5 font-medium">
                {aiBrief.riskVerdict === 'Aligned' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : aiBrief.riskVerdict === 'Elevated Event Risk' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
                )}
                <span>Verdict: {aiBrief.riskVerdict}</span>
              </div>
              <p className="leading-relaxed">{aiBrief.catalystSummary}</p>
              {aiBrief.bearRisks.length > 0 && (
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">Key Invalidation / Event Risks</div>
                  <ul className="mt-1 space-y-1 text-slate-600 dark:text-slate-400">
                    {aiBrief.bearRisks.map((r, i) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiBrief.sources.length > 0 && (
                <div className="pt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {aiBrief.sources.map((src, i) => (
                    <a
                      key={i}
                      href={src.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      <span className="truncate max-w-[160px]">{src.title}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
