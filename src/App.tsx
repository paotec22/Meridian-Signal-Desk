import { FileText, Loader2, Moon, RefreshCw, SlidersHorizontal, Sun } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BacktestView } from './components/BacktestView';
import { ConfigDrawer } from './components/ConfigDrawer';
import { DigestModal } from './components/DigestModal';
import { ScannerView } from './components/ScannerView';
import { SignalDetailPanel } from './components/SignalDetailPanel';
import { TrackRecordView } from './components/TrackRecordView';
import type { DashboardResponse, SignalRecord } from './types';

type NavTab = 'signals' | 'scanner' | 'backtest' | 'track-record';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('signals');
  const [darkMode, setDarkMode] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningPipeline, setRunningPipeline] = useState(false);

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<'all' | 'stock' | 'commodity' | 'crypto'>('all');
  const [directionFilter, setDirectionFilter] = useState<'actionable' | 'all'>('actionable');

  const [equity, setEquity] = useState(25000);
  const [riskPct, setRiskPct] = useState(1.0);

  const [showConfig, setShowConfig] = useState(false);
  const [showDigest, setShowDigest] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard?equity=${equity}&riskPct=${riskPct}`);
      const data = (await res.json()) as DashboardResponse & { error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to load dashboard');
      }
      setDashboard(data);
      setError(null);
      if (data.signals.length > 0 && !selectedSymbol) {
        const firstActionable = data.signals.find((s) => s.direction !== 'avoid') ?? data.signals[0];
        setSelectedSymbol(firstActionable.symbol);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach signal engine');
    } finally {
      setLoading(false);
    }
  }, [equity, riskPct, selectedSymbol]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Poll while initial market data bootstrap runs
  useEffect(() => {
    if (!dashboard?.bootstrapping) return;
    const timer = setInterval(() => {
      fetchDashboard();
    }, 2500);
    return () => clearInterval(timer);
  }, [dashboard?.bootstrapping, fetchDashboard]);

  const handleRunPipeline = async () => {
    setRunningPipeline(true);
    setError(null);
    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rangeYears: 2 }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Pipeline run failed');
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline execution error');
    } finally {
      setRunningPipeline(false);
    }
  };

  const filteredSignals = useMemo(() => {
    const list = dashboard?.signals ?? [];
    return list
      .filter((s) => (directionFilter === 'actionable' ? s.direction !== 'avoid' : true))
      .filter((s) => (classFilter === 'all' ? true : s.asset_class === classFilter));
  }, [dashboard?.signals, directionFilter, classFilter]);

  const selectedSignal: SignalRecord | null = useMemo(() => {
    if (!dashboard?.signals.length) return null;
    return (
      dashboard.signals.find((s) => s.symbol === selectedSymbol) ??
      filteredSignals[0] ??
      dashboard.signals[0]
    );
  }, [dashboard?.signals, filteredSignals, selectedSymbol]);

  const maxPosPct = dashboard?.config.risk.max_position_pct ?? 15;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1440px] mx-auto px-6 h-14 flex items-center justify-between gap-8">
          <a
            href="#signals"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('signals');
            }}
            className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display whitespace-nowrap shrink-0"
          >
            Meridian Desk
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {(
              [
                ['signals', 'Daily Signals'],
                ['scanner', 'Market Scanner'],
                ['backtest', 'Backtest Lab'],
                ['track-record', 'Track Record'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeTab === key
                    ? 'border-blue-700 text-slate-900 dark:text-slate-100 dark:border-blue-400'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleRunPipeline}
              disabled={runningPipeline || Boolean(dashboard?.pipelineRunning)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              {runningPipeline || dashboard?.pipelineRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {runningPipeline || dashboard?.pipelineRunning ? 'Ingesting Market Data...' : 'Run Daily Pipeline'}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Nav Strip */}
      <div className="md:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium">
        {(
          [
            ['signals', 'Daily Signals'],
            ['scanner', 'Market Scanner'],
            ['backtest', 'Backtest Lab'],
            ['track-record', 'Track Record'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`whitespace-nowrap shrink-0 pb-1 border-b-2 ${
              activeTab === key
                ? 'border-blue-700 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Workspace Toolbar */}
      <div className="bg-white/60 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1440px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-300">
            {dashboard?.regime ? (
              <>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  As of {dashboard.asOfDate}
                </span>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    dashboard.regime.sp500Bullish
                      ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                      : 'text-amber-700 dark:text-amber-400 font-medium'
                  }
                >
                  S&amp;P 500 {dashboard.regime.sp500Bullish ? 'above' : 'below'} 200DMA
                </span>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    dashboard.regime.btcBullish
                      ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                      : 'text-amber-700 dark:text-amber-400 font-medium'
                  }
                >
                  BTC {dashboard.regime.btcBullish ? 'above' : 'below'} 200DMA
                </span>
                {dashboard.lastRun && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {dashboard.lastRun.assets_processed} assets synced
                    </span>
                  </>
                )}
              </>
            ) : (
              <span>Preparing cross-asset market data...</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span>Equity $</span>
              <input
                type="number"
                min={500}
                step={500}
                value={equity}
                onChange={(e) => setEquity(Math.max(500, Number(e.target.value) || 500))}
                className="w-24 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span>Risk %</span>
              <input
                type="number"
                min={0.2}
                max={5}
                step={0.1}
                value={riskPct}
                onChange={(e) => setRiskPct(Math.max(0.1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-16 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </label>

            <button
              type="button"
              onClick={() => setShowDigest(true)}
              disabled={!dashboard?.digestText}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              Morning Digest
            </button>

            <button
              type="button"
              onClick={() => setShowConfig(true)}
              disabled={!dashboard?.config}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Rules &amp; Universe
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Toggle color theme"
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">
        {error && (
          <div className="mb-5 px-4 py-3 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {loading || dashboard?.bootstrapping ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-12 text-center space-y-3">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-700 dark:text-blue-400" />
            <h1 className="text-base font-semibold font-display">
              Ingesting Daily Market Data &amp; Computing Indicators
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Fetching 2 years of daily OHLCV bars across S&amp;P 500 equities, commodity futures, and crypto pairs, validating bars, and computing Wilder RSI, ATR, ADX, and relative strength.
            </p>
          </div>
        ) : activeTab === 'signals' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Slate: Ranked Signals + Correlation Matrix */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-display">
                      Ranked Signal Slate
                    </h1>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Rule-based swing setups (R:R ≥ {dashboard?.config.risk.min_risk_reward ?? 1.5})
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[11px]">
                    <button
                      type="button"
                      onClick={() => setDirectionFilter('actionable')}
                      className={`px-2 py-1 rounded transition-colors whitespace-nowrap ${
                        directionFilter === 'actionable'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Actionable
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirectionFilter('all')}
                      className={`px-2 py-1 rounded transition-colors whitespace-nowrap ${
                        directionFilter === 'all'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      All Scored
                    </button>
                  </div>
                </div>

                {/* Asset Class Filter */}
                <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto text-xs">
                  {(['all', 'stock', 'commodity', 'crypto'] as const).map((cls) => (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => setClassFilter(cls)}
                      className={`px-2.5 py-1 rounded capitalize transition-colors whitespace-nowrap ${
                        classFilter === cls
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-medium'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {cls}
                    </button>
                  ))}
                </div>

                {/* Ranked Rows */}
                {filteredSignals.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No setups currently meet the conviction threshold under this filter. Switch to All Scored or adjust weights in Rules &amp; Universe.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[540px] overflow-y-auto">
                    {filteredSignals.map((sig) => {
                      const active = selectedSignal?.symbol === sig.symbol;
                      return (
                        <button
                          key={sig.symbol}
                          type="button"
                          onClick={() => setSelectedSymbol(sig.symbol)}
                          className={`w-full text-left px-4 py-3 transition-colors flex items-center justify-between gap-3 ${
                            active
                              ? 'bg-blue-50/70 dark:bg-blue-950/30'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100">
                                {sig.symbol}
                              </span>
                              <span
                                className={`text-xs font-mono font-semibold uppercase ${
                                  sig.direction === 'long'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : sig.direction === 'short'
                                    ? 'text-red-700 dark:text-red-400'
                                    : 'text-slate-400'
                                }`}
                              >
                                {sig.direction}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                              {sig.name} · <span className="capitalize">{sig.asset_class}</span>
                            </div>
                          </div>

                          <div className="text-right font-mono tabular-nums shrink-0">
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {sig.score}
                              <span className="text-[11px] font-normal text-slate-400">/100</span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              R:R {sig.risk_reward.toFixed(1)} · {sig.position_pct}%
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 60-Day Correlation Matrix */}
              {dashboard?.correlationMatrix && dashboard.correlationMatrix.symbols.length > 1 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      60-Day Return Correlation Matrix (Top Picks)
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Diversification guard drops lower-scoring pairs exceeding 0.80 correlation.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono tabular-nums">
                      <thead>
                        <tr>
                          <th className="py-1 text-left text-slate-400" />
                          {dashboard.correlationMatrix.symbols.map((sym) => (
                            <th key={sym} className="py-1 px-1 text-right text-slate-500 dark:text-slate-400">
                              {sym.replace('-USD', '').replace('=F', '')}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.correlationMatrix.symbols.map((rowSym, i) => (
                          <tr key={rowSym}>
                            <td className="py-1 pr-2 font-medium text-slate-700 dark:text-slate-300">
                              {rowSym.replace('-USD', '').replace('=F', '')}
                            </td>
                            {dashboard.correlationMatrix.matrix[i].map((val, j) => (
                              <td
                                key={j}
                                className={`py-1 px-1 text-right ${
                                  i === j
                                    ? 'text-slate-400'
                                    : Math.abs(val) >= 0.7
                                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                    : 'text-slate-600 dark:text-slate-400'
                                }`}
                              >
                                {val.toFixed(2)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Right Workspace: Selected Signal Detail */}
            <div className="lg:col-span-7">
              {selectedSignal ? (
                <SignalDetailPanel
                  signal={selectedSignal}
                  equity={equity}
                  riskPct={riskPct}
                  maxPositionPct={maxPosPct}
                />
              ) : (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-12 text-center text-sm text-slate-500">
                  Select an asset from the signal slate to inspect levels and charts.
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'scanner' ? (
          <ScannerView equity={equity} riskPct={riskPct} maxPositionPct={maxPosPct} />
        ) : activeTab === 'backtest' ? (
          <BacktestView />
        ) : (
          <TrackRecordView />
        )}
      </main>

      {/* Quiet Legal & Data Disclosure Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 mt-10">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>
            Meridian Signal Desk · Decision-support research tool only, not financial advice. Signals can lose money.
          </span>
          <span>
            Daily close ingestion via Yahoo Finance &amp; Binance public market data · Wilder RSI/ATR/ADX
          </span>
        </div>
      </footer>

      {showConfig && dashboard?.config && (
        <ConfigDrawer
          config={dashboard.config}
          onClose={() => setShowConfig(false)}
          onConfigSaved={fetchDashboard}
        />
      )}

      {showDigest && dashboard?.digestText && (
        <DigestModal digestText={dashboard.digestText} onClose={() => setShowDigest(false)} />
      )}
    </div>
  );
}
