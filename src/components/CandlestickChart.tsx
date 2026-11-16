import { useMemo, useState } from 'react';
import type { ChartSeriesPoint, SignalRecord } from '../types';

interface Props {
  series: ChartSeriesPoint[];
  signal: SignalRecord | null;
  symbol: string;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

export function CandlestickChart({ series, signal, symbol }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(true);

  const visible = useMemo(() => series.slice(-120), [series]);

  const width = 820;
  const priceHeight = 250;
  const rsiHeight = 76;
  const padLeft = 12;
  const padRight = 72;
  const padTop = 16;
  const rsiTop = priceHeight + 28;
  const totalHeight = rsiTop + rsiHeight + 24;
  const plotW = width - padLeft - padRight;

  const { minPrice, maxPrice } = useMemo(() => {
    if (visible.length === 0) return { minPrice: 0, maxPrice: 100 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of visible) {
      if (d.low < lo) lo = d.low;
      if (d.high > hi) hi = d.high;
      if (showSma50 && d.sma_50 != null) {
        lo = Math.min(lo, d.sma_50);
        hi = Math.max(hi, d.sma_50);
      }
      if (showSma200 && d.sma_200 != null) {
        lo = Math.min(lo, d.sma_200);
        hi = Math.max(hi, d.sma_200);
      }
    }
    if (signal && signal.direction !== 'avoid') {
      lo = Math.min(lo, signal.stop_loss, signal.take_profit);
      hi = Math.max(hi, signal.stop_loss, signal.take_profit);
    }
    const span = Math.max(hi - lo, hi * 0.02);
    return { minPrice: lo - span * 0.06, maxPrice: hi + span * 0.06 };
  }, [visible, showSma50, showSma200, signal]);

  if (visible.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        No price history available for {symbol}.
      </div>
    );
  }

  const xForIdx = (i: number) => padLeft + ((i + 0.5) / visible.length) * plotW;
  const yForPrice = (p: number) =>
    padTop + ((maxPrice - p) / Math.max(maxPrice - minPrice, 1e-9)) * (priceHeight - padTop - 8);
  const yForRsi = (r: number) => rsiTop + ((100 - r) / 100) * rsiHeight;

  const buildPath = (getter: (d: ChartSeriesPoint) => number | null) => {
    let dStr = '';
    visible.forEach((pt, i) => {
      const val = getter(pt);
      if (val == null) return;
      const x = xForIdx(i).toFixed(1);
      const y = yForPrice(val).toFixed(1);
      dStr += dStr === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    return dStr;
  };

  const rsiPath = (() => {
    let dStr = '';
    visible.forEach((pt, i) => {
      if (pt.rsi_14 == null) return;
      const x = xForIdx(i).toFixed(1);
      const y = yForRsi(pt.rsi_14).toFixed(1);
      dStr += dStr === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    return dStr;
  })();

  const barW = Math.max(2, Math.min(6, (plotW / visible.length) * 0.66));
  const activePt = hoverIdx != null ? visible[hoverIdx] : visible[visible.length - 1];
  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minPrice + t * (maxPrice - minPrice));

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{activePt.date}</span>
          <span>O {fmtPrice(activePt.open)}</span>
          <span>H {fmtPrice(activePt.high)}</span>
          <span>L {fmtPrice(activePt.low)}</span>
          <span>C {fmtPrice(activePt.close)}</span>
          {activePt.rsi_14 != null && <span>RSI {activePt.rsi_14.toFixed(1)}</span>}
          {activePt.atr_14 != null && <span>ATR {fmtPrice(activePt.atr_14)}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSma20((v) => !v)}
            className={`px-2 py-1 text-xs rounded border transition-colors whitespace-nowrap shrink-0 ${
              showSma20
                ? 'border-amber-500/50 text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/30'
                : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            SMA 20
          </button>
          <button
            type="button"
            onClick={() => setShowSma50((v) => !v)}
            className={`px-2 py-1 text-xs rounded border transition-colors whitespace-nowrap shrink-0 ${
              showSma50
                ? 'border-blue-500/50 text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-950/30'
                : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            SMA 50
          </button>
          <button
            type="button"
            onClick={() => setShowSma200((v) => !v)}
            className={`px-2 py-1 text-xs rounded border transition-colors whitespace-nowrap shrink-0 ${
              showSma200
                ? 'border-indigo-500/50 text-indigo-700 dark:text-indigo-300 bg-indigo-50/70 dark:bg-indigo-950/30'
                : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            SMA 200
          </button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${totalHeight}`}
        className="w-full h-auto select-none overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width;
          const idx = Math.floor(((relX - padLeft) / plotW) * visible.length);
          if (idx >= 0 && idx < visible.length) setHoverIdx(idx);
        }}
      >
        {/* Price gridlines */}
        {priceTicks.map((t, idx) => {
          const y = yForPrice(t);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                className="stroke-slate-200/80 dark:stroke-slate-800"
                strokeWidth="1"
              />
              <text
                x={width - padRight + 6}
                y={y + 3}
                className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono tabular-nums"
              >
                {fmtPrice(t)}
              </text>
            </g>
          );
        })}

        {/* Signal Entry Zone, Stop, Target */}
        {signal && signal.direction !== 'avoid' && (
          <g>
            <rect
              x={padLeft}
              width={plotW}
              y={Math.min(yForPrice(signal.entry_high), yForPrice(signal.entry_low))}
              height={Math.max(2, Math.abs(yForPrice(signal.entry_low) - yForPrice(signal.entry_high)))}
              className="fill-blue-500/10"
            />
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={yForPrice(signal.take_profit)}
              y2={yForPrice(signal.take_profit)}
              stroke="#16A34A"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
            <text
              x={width - padRight + 6}
              y={yForPrice(signal.take_profit) + 3}
              className="fill-emerald-600 dark:fill-emerald-400 text-[10px] font-mono tabular-nums font-medium"
            >
              TP {fmtPrice(signal.take_profit)}
            </text>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={yForPrice(signal.stop_loss)}
              y2={yForPrice(signal.stop_loss)}
              stroke="#DC2626"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
            <text
              x={width - padRight + 6}
              y={yForPrice(signal.stop_loss) + 3}
              className="fill-red-600 dark:fill-red-400 text-[10px] font-mono tabular-nums font-medium"
            >
              SL {fmtPrice(signal.stop_loss)}
            </text>
          </g>
        )}

        {/* Candles */}
        {visible.map((d, i) => {
          const x = xForIdx(i);
          const up = d.close >= d.open;
          const color = up ? '#16A34A' : '#DC2626';
          const yHigh = yForPrice(d.high);
          const yLow = yForPrice(d.low);
          const yTop = yForPrice(Math.max(d.open, d.close));
          const yBot = yForPrice(Math.min(d.open, d.close));
          const bodyH = Math.max(1.5, yBot - yTop);
          return (
            <g key={d.date}>
              <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1" />
              <rect x={x - barW / 2} y={yTop} width={barW} height={bodyH} fill={color} rx="0.5" />
            </g>
          );
        })}

        {/* Moving averages */}
        {showSma20 && <path d={buildPath((d) => d.sma_20)} fill="none" stroke="#D97706" strokeWidth="1.2" />}
        {showSma50 && <path d={buildPath((d) => d.sma_50)} fill="none" stroke="#2563EB" strokeWidth="1.4" />}
        {showSma200 && <path d={buildPath((d) => d.sma_200)} fill="none" stroke="#6366F1" strokeWidth="1.5" />}

        {/* Hover vertical crosshair */}
        {hoverIdx != null && (
          <line
            x1={xForIdx(hoverIdx)}
            x2={xForIdx(hoverIdx)}
            y1={padTop}
            y2={rsiTop + rsiHeight}
            className="stroke-slate-400 dark:stroke-slate-500"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        )}

        {/* RSI Subplot */}
        <text x={padLeft} y={rsiTop - 6} className="fill-slate-500 dark:fill-slate-400 text-[10px] font-medium">
          RSI (14)
        </text>
        <rect
          x={padLeft}
          y={yForRsi(70)}
          width={plotW}
          height={yForRsi(30) - yForRsi(70)}
          className="fill-slate-200/40 dark:fill-slate-800/40"
        />
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={yForRsi(70)}
          y2={yForRsi(70)}
          className="stroke-slate-300 dark:stroke-slate-700"
          strokeDasharray="2 2"
        />
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={yForRsi(30)}
          y2={yForRsi(30)}
          className="stroke-slate-300 dark:stroke-slate-700"
          strokeDasharray="2 2"
        />
        <text x={width - padRight + 6} y={yForRsi(70) + 3} className="fill-slate-400 text-[10px] font-mono">
          70
        </text>
        <text x={width - padRight + 6} y={yForRsi(30) + 3} className="fill-slate-400 text-[10px] font-mono">
          30
        </text>
        <path d={rsiPath} fill="none" stroke="#2563EB" strokeWidth="1.4" />
      </svg>
    </div>
  );
}
