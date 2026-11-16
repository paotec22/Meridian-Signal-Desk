import { useState } from 'react';

interface Point {
  date: string;
  strategyEquity: number;
  benchmarkEquity: number;
}

export function EquityCurveChart({ data }: { data: Point[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length < 2) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-slate-500">
        Insufficient data to plot equity curve.
      </div>
    );
  }

  const width = 820;
  const height = 250;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of data) {
    minV = Math.min(minV, p.strategyEquity, p.benchmarkEquity);
    maxV = Math.max(maxV, p.strategyEquity, p.benchmarkEquity);
  }
  const padSpan = Math.max(maxV - minV, 2) * 0.08;
  minV -= padSpan;
  maxV += padSpan;

  const xFor = (i: number) => padL + (i / (data.length - 1)) * plotW;
  const yFor = (v: number) => padT + ((maxV - v) / (maxV - minV)) * plotH;

  const stratPath = data
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.strategyEquity).toFixed(1)}`)
    .join(' ');
  const benchPath = data
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.benchmarkEquity).toFixed(1)}`)
    .join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minV + t * (maxV - minV));
  const active = hoverIdx != null ? data[hoverIdx] : data[data.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-4 font-mono tabular-nums">
          <span className="text-slate-500 dark:text-slate-400">{active.date}</span>
          <span className="text-blue-700 dark:text-blue-400 font-medium">
            Strategy: {active.strategyEquity.toFixed(2)}
          </span>
          <span className="text-slate-600 dark:text-slate-300">
            S&amp;P 500 Benchmark: {active.benchmarkEquity.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-4 text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-blue-600" /> Strategy (Base 100)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-slate-400" /> S&amp;P 500 Buy &amp; Hold
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width;
          const idx = Math.round(((relX - padL) / plotW) * (data.length - 1));
          if (idx >= 0 && idx < data.length) setHoverIdx(idx);
        }}
      >
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={width - padR}
              y1={yFor(v)}
              y2={yFor(v)}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth="1"
            />
            <text
              x={padL - 6}
              y={yFor(v) + 3}
              textAnchor="end"
              className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono tabular-nums"
            >
              {v.toFixed(0)}
            </text>
          </g>
        ))}

        <path d={benchPath} fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={stratPath} fill="none" stroke="#1D4ED8" strokeWidth="2" />

        {hoverIdx != null && (
          <g>
            <line
              x1={xFor(hoverIdx)}
              x2={xFor(hoverIdx)}
              y1={padT}
              y2={height - padB}
              className="stroke-slate-400 dark:stroke-slate-500"
              strokeDasharray="2 2"
            />
            <circle cx={xFor(hoverIdx)} cy={yFor(active.strategyEquity)} r="3.5" fill="#1D4ED8" />
            <circle cx={xFor(hoverIdx)} cy={yFor(active.benchmarkEquity)} r="3" fill="#94A3B8" />
          </g>
        )}

        <text x={padL} y={height - 6} className="fill-slate-400 text-[10px] font-mono">
          {data[0].date}
        </text>
        <text x={width - padR} y={height - 6} textAnchor="end" className="fill-slate-400 text-[10px] font-mono">
          {data[data.length - 1].date}
        </text>
      </svg>
    </div>
  );
}
