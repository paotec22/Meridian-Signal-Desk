import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CryptoTradingMode, MarginMode, ScannerRow, SignalRecord, Timeframe } from '../types';
import { SignalDetailPanel } from './SignalDetailPanel';

interface Props {
  timeframe: Timeframe;
  equity: number;
  riskPct: number;
  maxPositionPct: number;
  cryptoMode: CryptoTradingMode;
  cryptoLeverage: number;
  marginMode: MarginMode;
  onChangeCryptoMode?: (mode: CryptoTradingMode) => void;
  onChangeLeverage?: (lev: number) => void;
  onChangeMarginMode?: (mode: MarginMode) => void;
}

type SortKey = 'score' | 'rsi_14' | 'adx_14' | 'ret_3m' | 'rel_strength' | 'vol_ratio_20' | 'symbol';

export function ScannerView({
  timeframe,
  equity,
  riskPct,
  maxPositionPct,
  cryptoMode,
  cryptoLeverage,
  marginMode,
  onChangeCryptoMode,
  onChangeLeverage,
  onChangeMarginMode,
}: Props) {
  const [rows, setRows] = useState<ScannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<'all' | 'stock' | 'commodity' | 'crypto'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState<ScannerRow | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/scanner?timeframe=${timeframe}&cryptoMode=${cryptoMode}`)
      .then((r) => r.json())
      .then((data) => {
        const nextRows = (data.rows ?? []) as ScannerRow[];
        setRows(nextRows);
        setSelected((prev) => {
          if (prev && nextRows.some((r) => r.symbol === prev.symbol)) {
            return nextRows.find((r) => r.symbol === prev.symbol) ?? nextRows[0] ?? null;
          }
          return nextRows[0] ?? null;
        });
      })
      .finally(() => setLoading(false));
  }, [timeframe, cryptoMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (classFilter === 'all' ? true : r.asset_class === classFilter))
      .filter(
        (r) =>
          !q ||
          r.symbol.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.sector.toLowerCase().includes(q) ||
          (r.cryptoFutures?.perpSymbol.toLowerCase().includes(q) ?? false)
      )
      .sort((a, b) => {
        if (sortKey === 'symbol') {
          return sortAsc ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
        }
        const av = a[sortKey] ?? -9999;
        const bv = b[sortKey] ?? -9999;
        return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
      });
  }, [rows, query, classFilter, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const selectedAsSignal: SignalRecord | null = selected
    ? {
        date: selected.date,
        asset_id: selected.id,
        symbol: selected.symbol,
        name: selected.name,
        asset_class: selected.asset_class,
        sector: selected.sector,
        direction: selected.direction,
        long_score: selected.long_score,
        short_score: selected.short_score,
        score: selected.score,
        close: selected.close,
        entry_low: selected.entry_low,
        entry_high: selected.entry_high,
        stop_loss: selected.stop_loss,
        take_profit: selected.take_profit,
        risk_reward: selected.risk_reward,
        position_pct: selected.position_pct,
        reasons: [`Long Score ${selected.long_score}/100 · Short Score ${selected.short_score}/100`],
        regime: '',
        cryptoFutures: selected.cryptoFutures ?? null,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter ticker, perp, name, or sector..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-md">
          {(['all', 'stock', 'commodity', 'crypto'] as const).map((cls) => (
            <button
              key={cls}
              type="button"
              onClick={() => setClassFilter(cls)}
              className={`px-3 py-1 text-xs font-medium rounded capitalize transition-colors whitespace-nowrap ${
                classFilter === cls
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {cls === 'all' ? `All (${rows.length})` : cls === 'crypto' && cryptoMode === 'futures' ? 'Crypto Perps' : cls}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading universe technical matrix...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left">
                  <th className="px-4 py-2.5 font-medium">
                    <button type="button" onClick={() => toggleSort('symbol')} className="inline-flex items-center gap-1">
                      Asset {sortKey === 'symbol' && (sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </button>
                  </th>
                  <th className="px-4 py-2.5 font-medium">Class · Sector</th>
                  <th className="px-4 py-2.5 font-medium text-right">Close</th>
                  {cryptoMode === 'futures' && (
                    <th className="px-4 py-2.5 font-medium text-right">8h Fund</th>
                  )}
                  <th className="px-4 py-2.5 font-medium text-right">
                    <button type="button" onClick={() => toggleSort('score')} className="inline-flex items-center gap-1">
                      Score {sortKey === 'score' && (sortAsc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </button>
                  </th>
                  <th className="px-4 py-2.5 font-medium">Bias</th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    <button type="button" onClick={() => toggleSort('rsi_14')} className="inline-flex items-center gap-1">
                      RSI 14
                    </button>
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    <button type="button" onClick={() => toggleSort('adx_14')} className="inline-flex items-center gap-1">
                      ADX 14
                    </button>
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    <button type="button" onClick={() => toggleSort('vol_ratio_20')} className="inline-flex items-center gap-1">
                      Vol Ratio
                    </button>
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    <button type="button" onClick={() => toggleSort('ret_3m')} className="inline-flex items-center gap-1">
                      3M Ret
                    </button>
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">
                    <button type="button" onClick={() => toggleSort('rel_strength')} className="inline-flex items-center gap-1">
                      Rel Str
                    </button>
                  </th>
                  <th className="px-4 py-2.5 font-medium text-right">52W Dist</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((r) => {
                  const isSel = selected?.symbol === r.symbol;
                  const isPerp = r.asset_class === 'crypto' && cryptoMode === 'futures';
                  const displaySymbol = isPerp
                    ? r.cryptoFutures?.perpSymbol ?? `${r.symbol.replace('-USD', '')}USDT`
                    : r.symbol;
                  return (
                    <tr
                      key={r.symbol}
                      onClick={() => setSelected(r)}
                      className={`cursor-pointer transition-colors ${
                        isSel
                          ? 'bg-blue-50/70 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {displaySymbol}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[150px]">
                          {r.name}
                          {isPerp ? ` · ${cryptoLeverage}× Perp` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 capitalize whitespace-nowrap">
                        {r.asset_class} · {r.sector}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {r.close >= 100 ? r.close.toFixed(2) : r.close.toFixed(3)}
                      </td>
                      {cryptoMode === 'futures' && (
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {r.cryptoFutures
                            ? `${r.cryptoFutures.fundingRatePct >= 0 ? '+' : ''}${r.cryptoFutures.fundingRatePct.toFixed(4)}%`
                            : '—'}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {r.score}
                      </td>
                      <td
                        className={`px-4 py-2.5 font-mono uppercase font-medium ${
                          r.direction === 'long'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : r.direction === 'short'
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {r.direction}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {r.rsi_14 != null ? r.rsi_14.toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {r.adx_14 != null ? r.adx_14.toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {r.vol_ratio_20 != null ? `${r.vol_ratio_20.toFixed(2)}x` : '—'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                          (r.ret_3m ?? 0) >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {r.ret_3m != null ? `${(r.ret_3m * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                          (r.rel_strength ?? 0) >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {r.rel_strength != null ? `${(r.rel_strength * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {r.pct_from_52w_high != null ? `${(r.pct_from_52w_high * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedAsSignal && (
        <SignalDetailPanel
          signal={selectedAsSignal}
          timeframe={timeframe}
          equity={equity}
          riskPct={riskPct}
          maxPositionPct={maxPositionPct}
          cryptoMode={cryptoMode}
          cryptoLeverage={cryptoLeverage}
          marginMode={marginMode}
          onChangeCryptoMode={onChangeCryptoMode}
          onChangeLeverage={onChangeLeverage}
          onChangeMarginMode={onChangeMarginMode}
        />
      )}
    </div>
  );
}
