# Meridian Signal Desk — Project Context

## Goal & Scope
Daily cross-asset swing trading decision-support engine scanning Equities (S&P 500 leaders), Commodities (9 futures), and Crypto (top non-stablecoin pairs). Generates transparent, rule-based long/short/avoid signals with entry zones, ATR stop-losses, take-profit targets, position sizing, correlation diversification, walk-forward backtesting, and an honest outcome track record.

## Architecture
- `config.yaml`: Configurable rule weights, regime filter thresholds, liquidity filters, risk sizing parameters, and backtest transaction costs.
- `src/engine/db.ts`: SQLite persistence (`data/signals.db` via `node:sqlite`) with `assets`, `prices_daily`, `indicators_daily`, `signals`, `signal_outcomes`, `pipeline_runs`, and `backtest_runs`.
- `src/engine/universe.ts`: Asset universe definitions and stablecoin/wrapped-token exclusion enforcement.
- `src/engine/ingestion.ts`: Abstract `DataSource` interface with `YahooFinanceSource`, `BinanceCryptoSource` (plus automatic fallback), retry/backoff, and OHLCV validation (positive prices, high >= low, >5d gap checks, >40% move flags).
- `src/engine/indicators.ts`: Causal technical indicator engine (SMA 20/50/200, EMA 12/26, MACD, Wilder RSI-14, Wilder ATR-14, Wilder ADX-14, Bollinger Width, Volume Ratio, 63/126/252d returns, 52w high distance, relative strength vs benchmark).
- `src/engine/signals.ts`: Transparent 0-100 rule-based scoring engine, market regime filter (S&P 500 & BTC vs 200DMA), and diversification ranking.
- `src/engine/risk.ts`: Entry zones, ATR stop-loss, resistance/R:R take-profit, equity-based position sizing, and 60-day return correlation matrix filtering.
- `src/engine/backtest.ts`: Next-day-open fill backtester with conservative intra-bar stop-first ordering, 15-day time stop, asset-class transaction costs, walk-forward splits, and parameter sensitivity check.
- `src/engine/outcomes.ts`: Daily outcome evaluator tracking historical signals against subsequent bars (target hit, stop hit, time exit, open).
- `src/engine/reporting.ts`: Morning digest formatter and optional Telegram Bot API delivery.
- `src/engine/ai.ts`: Server-side `@google/genai` (`gemini-4-hydrogen` + Google Search grounding) for qualitative catalyst & macro risk synthesis.
- `server.ts`: Express server mounting `/api/*` endpoints and Vite middleware on port 3000.

## Disclaimer
Decision-support tool only. Not financial advice. No signal system guarantees profit.
