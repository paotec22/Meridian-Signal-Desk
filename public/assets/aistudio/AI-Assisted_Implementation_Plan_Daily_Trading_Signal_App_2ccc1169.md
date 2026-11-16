# AI-Assisted Implementation Plan: Daily Trading Signal App

*A phase-by-phase build plan for a system that scans stocks, commodities and crypto daily, ranks them, and suggests a trade direction with risk levels. Written for a builder who will use AI coding assistants (Claude, Claude Code, Cursor, Copilot, etc.) to write most of the code.*

> **Disclaimer:** This is a decision-support tool, not a prediction machine and not financial advice. No signal system guarantees profit. If you share or sell the output to others, check the investment-advice regulations in your jurisdiction (e.g., SEC Nigeria).

## 1. Project Goals and Scope

**Goal:** Every day, automatically collect public market data, compute indicators, rank assets, and deliver a short list of suggested trades (asset, direction, entry zone, stop-loss, take-profit, score, reasons).

**Version 1 scope (keep it small):**

- **Stocks:** S&P 500 constituents (about 500 symbols)
- **Commodities:** 8 to 10 futures (gold, silver, crude oil, natural gas, copper, wheat, corn, soybeans, coffee)
- **Crypto:** top 30 by market cap, traded against USDT or USD
- **Timeframe:** daily candles; swing trades held days to weeks
- **Delivery:** Telegram message or email each morning, plus a Streamlit dashboard
- **Method:** transparent rule-based scoring (no machine learning in V1)

**Explicitly out of scope for V1:** intraday signals, automatic order execution, machine learning, social-media sentiment, options.

**Success criteria:**

1. The pipeline runs unattended every day for 30 consecutive days without manual fixes.
2. Every signal is logged with its inputs and later scored against what happened.
3. Backtest and paper-trading results are documented honestly, including losing periods.

## 2. How to Build This with AI: Working Method

AI writes code quickly but makes confident mistakes, especially in financial logic. Follow these rules throughout.

**Rule 1: Work in small vertical slices.** One module per prompt (e.g., "the Yahoo Finance fetcher"), never "build the whole app."

**Rule 2: Spec first, code second.** Before each module, give the AI: purpose, inputs, outputs, file path, libraries allowed, and edge cases. Ask it to restate the spec and list assumptions before coding.

**Rule 3: Tests alongside code.** For every module, ask the AI to write `pytest` tests in the same prompt. Run them yourself. Never accept code you have not executed.

**Rule 4: Version control from day one.** Commit after every working slice. If AI breaks something, you can revert.

**Rule 5: Keep a project context file.** Maintain a `PROJECT_CONTEXT.md` (or `CLAUDE.md` if using Claude Code) holding the architecture, folder structure, naming conventions, data schema and decisions made. Paste it at the start of each new AI session so the AI stays consistent.

**Rule 6: Verify financial logic manually.** Check at least a few indicator values (RSI, ATR, moving averages) against a trusted source such as TradingView for the same symbol and date. Check backtest logic by hand-tracing a few trades.

**Rule 7: Ask the AI to review its own work** in a fresh session: "Review this code for bugs, look-ahead bias, and unhandled errors."

**Rule 8: Never paste real API keys or brokerage credentials into AI chats.** Use placeholders and environment variables.

**Suggested AI tooling:**

- **Claude Code or Cursor** for writing and editing code across the repository
- **Claude chat** for architecture decisions, reviewing logic, and debugging
- **GitHub Copilot** (optional) for autocomplete

## 3. Architecture and Technology Stack

```
[Scheduler] -> [Ingestion] -> [Database] -> [Indicator Engine]
                                                  |
[Dashboard/Telegram] <- [Signal & Ranking] <- [Risk Module]
                                                  ^
                                           [Backtester]
```

| Layer | Choice | Why |
| --- | --- | --- |
| Language | Python 3.11+ | Best finance and data ecosystem |
| Data handling | pandas, numpy | Standard |
| Stock/commodity data | yfinance (primary), Twelve Data or Alpha Vantage (backup) | Free, accessible |
| Crypto data | ccxt (Binance/Coinbase public endpoints), CoinGecko (market cap list) | Unified interface |
| Macro data | FRED API (via `fredapi`) | Official, free key |
| Indicators | pandas-ta or TA-Lib | Tested implementations |
| Backtesting | vectorbt | Fast, vectorised |
| Database | SQLite (V1), PostgreSQL later | Simple start, easy migration via SQLAlchemy |
| API layer | FastAPI (optional in V1) | Clean separation of logic and UI |
| Dashboard | Streamlit + Plotly | Fastest path to a usable UI |
| Notifications | python-telegram-bot or SMTP | Free and reliable |
| Scheduling | GitHub Actions cron (simplest) or cron on a VPS | Low cost |
| Config | `.env` + `config.yaml` | Secrets separate from settings |
| Quality | pytest, ruff, mypy (optional) | Catches AI mistakes |
| Hosting | Small VPS (Hetzner/DigitalOcean) or Streamlit Community Cloud | Around $5 to $10 per month |

**Data availability note:** Free sources, especially `yfinance`, are unofficial and can change or throttle without notice. Check each provider's current terms and rate limits before relying on them, and build the ingestion layer so a source can be swapped without touching the rest of the system.

## 4. Repository Structure

```
trading-signals/
  PROJECT_CONTEXT.md
  README.md
  config.yaml
  .env.example
  requirements.txt
  src/
    config.py
    db.py
    models.py
    ingestion/
      base.py            # abstract DataSource interface
      yahoo.py           # stocks + commodities
      crypto.py          # ccxt wrapper
      universe.py        # builds the symbol lists
      macro.py           # FRED
      run_ingestion.py
    indicators/
      engine.py          # computes all features
    signals/
      rules.py           # long/short conditions
      scoring.py         # weighted score 0-100
      ranking.py         # top-N selection, filters
      regime.py          # market regime filter
    risk/
      levels.py          # stop, target, R:R
      sizing.py          # position size
      portfolio.py       # correlation and exposure checks
    backtest/
      runner.py
      metrics.py
      walk_forward.py
    reporting/
      formatter.py
      telegram_bot.py
      email_sender.py
    evaluation/
      outcome_tracker.py # scores past signals against actual results
    pipeline.py          # orchestrates the daily run
  dashboard/
    app.py
  tests/
  scripts/
  .github/workflows/daily.yml
```

## 5. Data Model

**Table `assets`**: `id`, `symbol`, `name`, `asset_class` (stock/commodity/crypto), `source`, `active`, `added_at`

**Table `prices_daily`**: `asset_id`, `date`, `open`, `high`, `low`, `close`, `adj_close`, `volume`; unique on (`asset_id`, `date`)

**Table `indicators_daily`**: `asset_id`, `date`, plus one column per indicator (sma\_20, sma\_50, sma\_200, rsi\_14, atr\_14, adx\_14, macd, macd\_signal, bb\_width, vol\_ratio\_20, ret\_3m, ret\_6m, rel\_strength, pct\_from\_52w\_high, and so on)

**Table `signals`**: `id`, `date`, `asset_id`, `direction` (long/short/avoid), `score`, `entry_low`, `entry_high`, `stop_loss`, `take_profit`, `risk_reward`, `reasons_json`, `regime`, `created_at`

**Table `signal_outcomes`**: `signal_id`, `evaluated_at`, `exit_reason` (stop/target/time), `exit_price`, `return_pct`, `holding_days`

**Table `pipeline_runs`**: `run_id`, `started_at`, `finished_at`, `status`, `assets_processed`, `errors_json`

## 6. Phased Implementation Plan

Each phase lists the objective, tasks, an example AI prompt, and acceptance criteria. Do not move on until acceptance criteria pass.

### Phase 0: Setup (Day 1 to 2)

**Objective:** A clean, reproducible project skeleton.

**Tasks:**

1. Create the GitHub repository and the folder structure above.
2. Create a virtual environment and `requirements.txt`.
3. Write `PROJECT_CONTEXT.md` (use the content of sections 1, 3, 4 and 5 of this document).
4. Add `.env.example`, `.gitignore` (exclude `.env`, database files, caches), and a config loader.
5. Set up `pytest` and `ruff`.

**Example prompt:**

> "Using the attached PROJECT\_CONTEXT.md, generate the project skeleton: empty modules with docstrings, a `config.py` that loads `config.yaml` and `.env` using pydantic-settings, and a passing placeholder test. Python 3.11. List every file you create."

**Acceptance:** `pytest` passes; project installs cleanly on a fresh machine from the README.

### Phase 1: Database layer (Day 2 to 3)

**Tasks:** Implement SQLAlchemy models for the tables in section 5, a `db.py` session helper, and an initialisation script. Add upsert helpers so re-running ingestion never creates duplicates.

**Example prompt:**

> "Write SQLAlchemy 2.0 models for these tables \[paste schema\]. Add a function `upsert_prices(df)` that inserts or updates on the unique key. Include pytest tests using an in-memory SQLite database."

**Acceptance:** Inserting the same price row twice leaves one row; tests pass.

### Phase 2: Universe builder (Day 3 to 4)

**Tasks:**

1. Stocks: fetch the S&P 500 list (for example from the Wikipedia constituents table via `pandas.read_html`, or a maintained CSV) and normalise tickers (e.g., `BRK.B` becomes `BRK-B` for Yahoo).
2. Commodities: a fixed mapping in `config.yaml` (`GC=F`, `SI=F`, `CL=F`, `NG=F`, `HG=F`, `ZW=F`, `ZC=F`, `ZS=F`, `KC=F`).
3. Crypto: pull the top 30 by market cap from CoinGecko, map to exchange pairs available on your chosen exchange via `ccxt`; exclude stablecoins and wrapped tokens.
4. Store in `assets`; mark delisted symbols inactive rather than deleting them.

**Acceptance:** `assets` contains roughly 540 active rows with correct asset classes; a unit test confirms stablecoins are excluded.

### Phase 3: Ingestion (Day 4 to 8)

**Tasks:**

1. Define an abstract `DataSource` with `fetch_daily(symbol, start, end) -> DataFrame` returning the standard columns.
2. Implement `yahoo.py` using `yfinance` batch downloads (chunks of 50 to 100 symbols) with retry and exponential backoff.
3. Implement `crypto.py` using `ccxt` `fetch_ohlcv` on the daily timeframe, paginated.
4. Implement backfill (3 to 5 years) and incremental update (only new days).
5. Data validation: reject rows with non-positive prices, high below low, or duplicate dates; flag gaps longer than 5 trading days; flag one-day moves above 40% for manual review (could be a split or a data error).
6. Use adjusted close for stocks to handle splits and dividends.
7. Log every run into `pipeline_runs`; send an alert if more than 5% of symbols fail.

**Example prompt:**

> "Implement `YahooSource.fetch_daily_batch(symbols, start, end)` returning a long-format DataFrame with columns \[symbol, date, open, high, low, close, adj\_close, volume\]. Handle partial failures (return what succeeded and list failures), retry up to 3 times with exponential backoff, and write pytest tests using mocked responses."

**Acceptance:** A full backfill completes; spot-check 5 random symbols against TradingView or the exchange; a second run adds zero duplicates; killing the network mid-run produces a clear error log, not a crash.

### Phase 4: Indicator engine (Day 8 to 11)

**Tasks:**

1. Compute per asset: SMA 20/50/200, EMA 12/26, MACD, RSI(14), ATR(14), ADX(14), Bollinger width, volume ratio (volume divided by 20-day average volume), 63/126/252-day returns, distance from 52-week high and low.
2. Relative strength: asset return minus benchmark return (S&P 500 `^GSPC` or SPY for stocks, BTC for altcoins, a broad commodity index or DXY for commodities).
3. Compute using only data up to and including each date (no future data).
4. Store results in `indicators_daily`; recompute only recent rows daily.

**Verification step (critical):** Pick 3 symbols and 3 dates; compare RSI, ATR and SMA values with TradingView. Differences should be tiny. Different smoothing methods (Wilder versus simple) cause mismatches, so tell the AI which one to use.

**Acceptance:** Indicator tests pass against known fixture values; no NaN values after the warm-up period (first 200 rows).

### Phase 5: Signal, scoring and ranking logic (Day 11 to 15)

**Starter rule set (configurable in `config.yaml`):**

| Condition (long) | Points |
| --- | --- |
| Close above SMA 50 | 15 |
| Close above SMA 200 | 15 |
| SMA 50 above SMA 200 | 10 |
| RSI between 50 and 70 | 15 |
| ADX above 20 | 15 |
| MACD above its signal line | 10 |
| Volume ratio above 1.0 on recent up days | 10 |
| Positive relative strength versus benchmark | 10 |

Short setups mirror these (below averages, RSI 30 to 50, MACD below signal, negative relative strength).

**Rules:**

- Score above 70: candidate. Between the long and short scores, pick the higher; if both are below 60, output "avoid".
- **Filters:** minimum average daily dollar volume (e.g., $5M for stocks) to avoid illiquid names; skip assets with fewer than 250 days of history; skip assets with earnings within 3 days (if earnings data is added).
- **Regime filter:** if the S&P 500 is below its 200-day average, cut long scores by 20 percent or cap long suggestions at 3; the equivalent for crypto uses BTC against its 200-day average.
- **Diversification:** at most 5 to 10 picks total, with caps per asset class and per correlated cluster.
- **Explainability:** each signal stores a human-readable list of reasons (e.g., "Above 50 and 200-day MA; RSI 62; ADX 27").

**Example prompt:**

> "Implement `score_asset(row, config) -> dict` returning long\_score, short\_score, and reasons\[\]. Weights come from config. Add tests where I supply hand-built indicator rows and verify the expected scores."

**Acceptance:** Given fixtures, scores match hand calculation; changing a weight in config changes output without code edits.

### Phase 6: Risk module (Day 15 to 17)

**Tasks:**

1. **Entry zone:** last close to last close plus 0.5 ATR for longs (mirror for shorts).
2. **Stop-loss:** entry minus 2 times ATR for longs (plus for shorts). Optionally use the most recent swing low.
3. **Take-profit:** the larger of 2 times risk and the next resistance level; reject setups with risk-reward below 1.5.
4. **Position size:** `account_equity * risk_pct / (entry - stop)`, with `risk_pct` default 1 percent; cap any single position at 10 to 20 percent of equity.
5. **Portfolio check:** compute a 60-day return correlation matrix of the picks; drop the lower-scoring one when correlation exceeds 0.8.
6. **Time stop:** exit review after 15 trading days if neither stop nor target was hit.

**Acceptance:** Unit tests for each formula with simple numbers (e.g., entry 100, ATR 2, stop 96, risk 1 percent of $10,000 means 25 shares).

### Phase 7: Backtesting (Day 17 to 24)

**Tasks:**

1. Implement the signal rules as vectorised functions usable across history.
2. **Execution assumption:** signal on day T close, fill at day T+1 open. Never fill at the signal candle's close.
3. Include costs: stocks (0.05% slippage plus commission), crypto (0.1% fee plus 0.05% slippage), futures (spread estimate).
4. Simulate stops and targets using daily highs and lows; if both are touched in the same candle, assume the stop was hit first (conservative).
5. Walk-forward test: for example, optimise on 2 years, test on the next 6 months, roll forward.
6. Report: total return, CAGR, win rate, average win and loss, profit factor, Sharpe, max drawdown, number of trades, exposure, and results split by asset class and by market regime. Compare with simple buy-and-hold of the benchmark.
7. Run a sensitivity test: shift each parameter by 20 percent. If results collapse, the strategy is overfit.

**Known limitations to document:** survivorship bias (current S&P 500 members only), free-data inaccuracies, and costs being estimates.

**Decision gate:** If the strategy does not beat its benchmark on risk-adjusted terms out-of-sample, revise the rules or stop. Do not proceed to live use just because the code works.

**Example prompt:**

> "Write a vectorbt backtest for this rule set with next-day-open entries, ATR stops, fees, and walk-forward splits. Then write a separate test that deliberately injects a look-ahead bug and confirms our checks catch it."

### Phase 8: Reporting and delivery (Day 24 to 28)

**Daily message format:**

```
Daily Signals | 2026-11-17 (data as of close 2026-11-16)
Regime: S&P above 200DMA (bullish) | BTC above 200DMA

1. NVDA (stock) LONG score 84
   Entry 138.2-139.1 | Stop 131.5 | Target 152.0 | R:R 2.0
   Why: above 50/200 MA, RSI 63, ADX 29, volume 1.4x avg
...
Not financial advice. Signals can lose money.
```

**Tasks:** build the formatter, Telegram bot sender (token in `.env`), email fallback, and the Streamlit dashboard with: ranked table, candlestick chart with moving averages and signal markers, signal history, and a **track-record page** (hit rate, average return, drawdown of all past signals).

**Acceptance:** A test run delivers a correctly formatted message to your phone; dashboard loads in under 5 seconds from the database.

### Phase 9: Automation and monitoring (Day 28 to 32)

**Tasks:**

1. `pipeline.py` runs: ingest, validate, compute indicators, score, risk-adjust, save signals, send report, log the run.
2. Schedule: stocks and commodities after the US close (e.g., 22:00 UTC), crypto after the 00:00 UTC daily candle. Run the report once, early morning in your timezone, after both are updated.
3. Failure handling: if a source fails, fall back to the backup or send an alert instead of a partial or misleading report. Never send stale data without labelling it.
4. Add a daily heartbeat alert if the pipeline did not run.
5. Add `outcome_tracker.py` to evaluate each open signal daily against stops, targets and time limits.

**Acceptance:** 7 consecutive unattended days with correct reports.

### Phase 10: Paper trading and evaluation (Weeks 6 to 18)

Run the live system with no real money for at least 8 to 12 weeks. Log every signal and outcome. Compare with the backtest: win rate, average return and drawdown should be in the same neighbourhood. Large deviations signal a bug, overfitting or changed market conditions.

**Decision gate before real money:**

- Positive expectancy after costs over at least 50 to 100 paper signals
- Drawdown within what you can tolerate emotionally and financially
- No unresolved data or logic bugs

If proceeding, begin with a small amount you can afford to lose entirely, and keep manual control of execution.

### Phase 11: Upgrades (after the basics are proven)

- Earnings-calendar and fundamentals filters (Financial Modeling Prep, Finnhub)
- News sentiment with FinBERT or an LLM, strictly as an additional filter and validated in backtests
- Gradient-boosted models (LightGBM) compared against the rule-based baseline using walk-forward validation
- Broker integration (Alpaca for US stocks, Binance for crypto) with tiny sizes, hard loss limits and a kill switch
- PostgreSQL migration, user accounts, and a mobile-friendly front end

## 7. Testing Strategy

| Level | What | Tool |
| --- | --- | --- |
| Unit | Indicators, scoring, risk formulas, validators | pytest |
| Integration | Ingestion to database to indicators to signals on a small fixture dataset | pytest |
| Regression | Frozen sample data with expected signals, so rule changes are visible | pytest snapshot |
| Backtest integrity | Look-ahead injection test; shuffled-labels test should give about zero edge | custom |
| Manual | Cross-check values with TradingView and exchange charts | you |
| Operational | Simulate API failure, empty response, and rate limiting | mocks |

## 8. Deployment and Operations

- **Simplest path:** GitHub Actions scheduled workflow runs the pipeline and commits the SQLite database to a private branch or storage bucket; Streamlit Community Cloud reads from it.
- **More robust path:** a VPS running cron or systemd timers, SQLite or PostgreSQL, Streamlit behind Nginx, with daily database backups.
- Keep secrets in environment variables or the platform's secret store.
- Keep logs for at least 30 days.
- Pin library versions in `requirements.txt`; update deliberately, since data libraries change behaviour.
- Document a recovery procedure (restore database, rerun backfill).

## 9. Legal, Ethical and Data Considerations

- **Data terms:** confirm that your sources allow your intended use. Personal use of free APIs is usually fine; redistribution or commercial use often requires a paid license.
- **Regulation:** publishing specific buy and sell recommendations to others may count as investment advice or require registration in some countries. Check local rules before sharing or selling signals.
- **Disclosure:** every report should state that signals are informational, not advice, and can lose money.
- **Honesty:** publish the full track record, including losses, if you ever share results.

## 10. Risk Register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Free data source breaks or throttles | High | High | Source abstraction, backup provider, alerts |
| AI-generated code contains subtle bugs | High | High | Tests, manual verification, independent AI review |
| Look-ahead or survivorship bias inflates backtest | High | High | Next-open fills, walk-forward, documented limits |
| Overfitting rules to history | Medium | High | Few parameters, sensitivity tests, out-of-sample validation |
| Strategy stops working as the market regime changes | Medium | Medium | Regime filter, monthly performance review |
| Real losses from trusting signals too early | Medium | High | Mandatory paper trading, small starting size, fixed risk per trade |
| API keys leaked | Low | High | `.env`, secret scanning, never share keys with AI |
| Regulatory problems when sharing signals | Medium | Medium | Legal check before distribution |

## 11. Timeline Summary (Solo Builder with AI)

| Phase | Duration |
| --- | --- |
| 0 to 2: Setup, database, universe | Week 1 |
| 3: Ingestion | Week 1 to 2 |
| 4 to 6: Indicators, signals, risk | Weeks 2 to 3 |
| 7: Backtesting | Weeks 3 to 4 |
| 8 to 9: Reporting and automation | Weeks 4 to 5 |
| 10: Paper trading | Weeks 6 to 18 |
| 11: Upgrades | After validation |

## 12. Master Prompt Templates

**Session starter (paste at the beginning of every AI session):**

> "You are helping me build a Python daily trading-signal app. Here is PROJECT\_CONTEXT.md: \[paste\]. Follow its structure and naming. Write production-quality, typed, documented code with pytest tests. Before coding, restate the task and list your assumptions. Never invent library functions; if unsure, say so."

**Module request:**

> "Task: \[module\]. File: \[path\]. Inputs: \[..\]. Outputs: \[..\]. Edge cases: \[..\]. Constraints: \[libraries, no look-ahead, config-driven\]. Also produce tests and a short usage example."

**Code review:**

> "Review the following module as a skeptical senior quant engineer. Look for look-ahead bias, off-by-one errors, timezone problems, unhandled API failures, and silent NaN propagation. List issues by severity with suggested fixes."

**Debugging:**

> "Here is the error, the relevant code, and the input data sample: \[..\]. Explain the root cause first, then propose the minimal fix, then a test that would have caught it."

## 13. Definition of Done (V1)

- [ ] Universe of about 540 assets loads and updates automatically
- [ ] Daily ingestion with validation, retries and alerts
- [ ] Indicators verified against an external source
- [ ] Transparent scoring with config-driven weights and stored reasons
- [ ] Risk levels and position sizing on every signal
- [ ] Backtest with costs, next-open fills and walk-forward results documented
- [ ] Daily Telegram or email report and Streamlit dashboard live
- [ ] Outcome tracker scoring all past signals
- [ ] 30 days of unattended operation
- [ ] 8 to 12 weeks of paper trading reviewed against the backtest
- [ ] Legal and data-license check completed

## 14. Suggested First Actions (This Week)

1. Create the repository and `PROJECT_CONTEXT.md` from this document.
2. Get free API keys you need (FRED; Telegram bot token via BotFather; optionally Twelve Data or Alpha Vantage as backup).
3. Run Phase 0 and Phase 1 with your AI assistant, committing after each.
4. Build the Yahoo ingestion for 10 symbols first, verify data against TradingView, then scale to the full universe.
