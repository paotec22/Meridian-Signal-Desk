import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { AppConfig, AssetClass, Timeframe } from '../types';

interface Props {
  config: AppConfig;
  timeframe: Timeframe;
  onClose: () => void;
  onConfigSaved: () => void;
}

export function ConfigDrawer({ config, timeframe, onClose, onConfigSaved }: Props) {
  const [weights, setWeights] = useState({ ...config.scoring_weights });
  const [risk, setRisk] = useState({ ...config.risk });
  const [bearishMult, setBearishMult] = useState(config.regime.bearish_long_multiplier);
  const [cryptoFutures, setCryptoFutures] = useState({
    enabled_by_default: config.crypto_futures?.enabled_by_default ?? false,
    default_leverage: config.crypto_futures?.default_leverage ?? 3,
    max_leverage: config.crypto_futures?.max_leverage ?? 20,
    margin_mode: config.crypto_futures?.margin_mode ?? ('isolated' as const),
    taker_fee_bps: config.crypto_futures?.taker_fee_bps ?? 5,
    maintenance_margin_rate: config.crypto_futures?.maintenance_margin_rate ?? 0.005,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Add custom asset form
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [newClass, setNewClass] = useState<AssetClass>('stock');
  const [addingAsset, setAddingAsset] = useState(false);
  const [assetMsg, setAssetMsg] = useState<string | null>(null);

  const totalWeight = Object.values(weights).reduce((s, v) => s + Number(v || 0), 0);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeframe,
          scoring_weights: weights,
          risk,
          regime: { ...config.regime, bearish_long_multiplier: bearishMult },
          crypto_futures: cryptoFutures,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to save config');
      setMsg('Saved to config.yaml and re-scored signals.');
      onConfigSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol.trim()) return;
    setAddingAsset(true);
    setAssetMsg(null);
    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: newSymbol.trim(),
          name: newName.trim() || newSymbol.trim().toUpperCase(),
          asset_class: newClass,
          timeframe,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to ingest symbol');
      setAssetMsg(`Ingested ${data.barsInserted} ${timeframe.toUpperCase()} bars for ${data.asset.symbol}.`);
      setNewSymbol('');
      setNewName('');
      onConfigSaved();
    } catch (err) {
      setAssetMsg(err instanceof Error ? err.message : 'Failed to add asset');
    } finally {
      setAddingAsset(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[1px]">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 font-display">
            Strategy Rules &amp; Universe
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close configuration"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-8 flex-1">
          {/* Custom Symbol Ingestion */}
          <form onSubmit={handleAddAsset} className="space-y-3 pb-6 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Add Symbol to Universe
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ingest 2 years of daily OHLCV bars and compute indicators immediately (e.g. PLTR, COIN, ETH-USD, ZN=F).
            </p>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                placeholder="Ticker (e.g. PLTR)"
                className="px-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono"
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (optional)"
                className="px-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              <select
                value={newClass}
                onChange={(e) => setNewClass(e.target.value as AssetClass)}
                className="px-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="stock">Stock</option>
                <option value="commodity">Commodity</option>
                <option value="crypto">Crypto</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                type="submit"
                disabled={addingAsset || !newSymbol.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                {addingAsset ? 'Ingesting...' : 'Ingest Symbol'}
              </button>
              {assetMsg && <span className="text-xs text-slate-600 dark:text-slate-300">{assetMsg}</span>}
            </div>
          </form>

          {/* Config.yaml Scoring & Risk Rules */}
          <form onSubmit={handleSaveConfig} className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Scoring Weights (config.yaml)
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Total: {totalWeight} pts
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {(Object.keys(weights) as Array<keyof typeof weights>).map((key) => (
                <label key={key} className="block space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 block capitalize">
                    {key.replaceAll('_', ' ')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={weights[key]}
                    onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
                    className="w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-slate-900 dark:text-slate-100"
                  />
                </label>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Risk &amp; Regime Parameters
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="block space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 block">Stop ATR Multiplier</span>
                  <input
                    type="number"
                    step="0.1"
                    min={0.5}
                    max={5}
                    value={risk.stop_atr_multiplier}
                    onChange={(e) => setRisk({ ...risk, stop_atr_multiplier: Number(e.target.value) })}
                    className="w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 block">Target R-Multiple</span>
                  <input
                    type="number"
                    step="0.1"
                    min={1.0}
                    max={6}
                    value={risk.target_r_multiple}
                    onChange={(e) => setRisk({ ...risk, target_r_multiple: Number(e.target.value) })}
                    className="w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 block">Max Position %</span>
                  <input
                    type="number"
                    step="1"
                    min={2}
                    max={50}
                    value={risk.max_position_pct}
                    onChange={(e) => setRisk({ ...risk, max_position_pct: Number(e.target.value) })}
                    className="w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 block">Bearish Long Multiplier</span>
                  <input
                    type="number"
                    step="0.05"
                    min={0.3}
                    max={1.0}
                    value={bearishMult}
                    onChange={(e) => setBearishMult(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
                  />
                </label>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Crypto Perpetual Futures Defaults
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="block space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 block">Default Crypto Mode</span>
                  <select
                    value={cryptoFutures.enabled_by_default ? 'futures' : 'spot'}
                    onChange={(e) =>
                      setCryptoFutures({ ...cryptoFutures, enabled_by_default: e.target.value === 'futures' })
                    }
                    className="w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="spot">Spot (1×)</option>
                    <option value="futures">Perpetual Futures</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 block">Default Margin Mode</span>
                  <select
                    value={cryptoFutures.margin_mode}
                    onChange={(e) =>
                      setCryptoFutures({
                        ...cryptoFutures,
                        margin_mode: e.target.value === 'cross' ? 'cross' : 'isolated',
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="isolated">Isolated</option>
                    <option value="cross">Cross</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 block">Default Leverage (×)</span>
                  <input
                    type="number"
                    min={1}
                    max={cryptoFutures.max_leverage}
                    value={cryptoFutures.default_leverage}
                    onChange={(e) =>
                      setCryptoFutures({
                        ...cryptoFutures,
                        default_leverage: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-600 dark:text-slate-400 block">Perp Taker Fee (bps)</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={cryptoFutures.taker_fee_bps}
                    onChange={(e) =>
                      setCryptoFutures({
                        ...cryptoFutures,
                        taker_fee_bps: Math.max(1, Number(e.target.value) || 5),
                      })
                    }
                    className="w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
                  />
                </label>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
              >
                {saving ? 'Saving...' : 'Save & Re-Score Signals'}
              </button>
              {msg && <span className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</span>}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
