export type AssetClass = 'stock' | 'commodity' | 'crypto' | 'benchmark';

export type SignalDirection = 'long' | 'short' | 'avoid';

export type ExitReason = 'target' | 'stop' | 'time' | 'open';

export interface AssetRow {
  id: number;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  sector: string;
  source: string;
  active: number;
  added_at: string;
}

export interface PriceBar {
  asset_id: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adj_close: number;
  volume: number;
}

export interface IndicatorRow {
  asset_id: number;
  date: string;
  sma_20: number | null;
  sma_50: number | null;
  sma_200: number | null;
  ema_12: number | null;
  ema_26: number | null;
  rsi_14: number | null;
  atr_14: number | null;
  adx_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  bb_width: number | null;
  vol_ratio_20: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_12m: number | null;
  rel_strength: number | null;
  pct_from_52w_high: number | null;
  dollar_vol_20: number | null;
}

export interface SignalRecord {
  id?: number;
  date: string;
  asset_id: number;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  sector: string;
  direction: SignalDirection;
  long_score: number;
  short_score: number;
  score: number;
  close: number;
  entry_low: number;
  entry_high: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  position_pct: number;
  reasons: string[];
  regime: string;
  created_at?: string;
}

export interface SignalOutcomeRow {
  signal_id: number;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  signal_date: string;
  direction: SignalDirection;
  score: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  evaluated_at: string;
  status: 'closed' | 'open';
  exit_reason: ExitReason;
  exit_price: number;
  return_pct: number;
  holding_days: number;
  r_multiple: number;
}

export interface PipelineRunRow {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'completed' | 'partial' | 'failed';
  assets_processed: number;
  signals_generated: number;
  errors_json: string;
  warnings_json: string;
}

export interface AppConfig {
  universe: {
    stocks_benchmark: string;
    crypto_benchmark: string;
    commodities_benchmark: string;
    excluded_crypto_tokens: string[];
  };
  filters: {
    min_history_days: number;
    min_stock_dollar_volume_20d: number;
    min_crypto_dollar_volume_20d: number;
    min_commodity_dollar_volume_20d: number;
    candidate_threshold: number;
    avoid_threshold: number;
    max_picks_total: number;
    max_picks_per_class: number;
  };
  regime: {
    bearish_long_multiplier: number;
    bearish_max_long_picks: number;
  };
  scoring_weights: {
    above_sma50: number;
    above_sma200: number;
    sma50_above_sma200: number;
    rsi_momentum_band: number;
    adx_trend_strength: number;
    macd_cross: number;
    volume_confirmation: number;
    relative_strength: number;
  };
  scoring_thresholds: {
    long_rsi_min: number;
    long_rsi_max: number;
    short_rsi_min: number;
    short_rsi_max: number;
    adx_min: number;
    vol_ratio_min: number;
  };
  risk: {
    entry_atr_band: number;
    stop_atr_multiplier: number;
    min_risk_reward: number;
    target_r_multiple: number;
    default_account_equity: number;
    default_risk_pct: number;
    max_position_pct: number;
    correlation_window_days: number;
    max_pair_correlation: number;
    time_stop_days: number;
  };
  backtest: {
    stock_cost_bps: number;
    commodity_cost_bps: number;
    crypto_cost_bps: number;
    walk_forward_train_days: number;
    walk_forward_test_days: number;
  };
}

export interface RegimeStatus {
  sp500Close: number;
  sp500Sma200: number;
  sp500Bullish: boolean;
  btcClose: number;
  btcSma200: number;
  btcBullish: boolean;
  dxyClose: number;
  dxySma50: number;
  summary: string;
}

export interface BacktestTrade {
  symbol: string;
  asset_class: AssetClass;
  direction: 'long' | 'short';
  signal_date: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  stop_loss: number;
  take_profit: number;
  score: number;
  regime: 'bullish' | 'bearish';
  exit_reason: 'target' | 'stop' | 'time';
  return_pct: number;
  net_return_pct: number;
  r_multiple: number;
  holding_days: number;
}

export interface BacktestSummary {
  totalReturnPct: number;
  cagrPct: number;
  benchmarkReturnPct: number;
  winRatePct: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  totalTrades: number;
  avgHoldingDays: number;
  byAssetClass: Record<string, { trades: number; winRatePct: number; avgReturnPct: number }>;
  byRegime: Record<string, { trades: number; winRatePct: number; avgReturnPct: number }>;
  walkForwardWindows: Array<{
    window: string;
    period: string;
    trades: number;
    winRatePct: number;
    returnPct: number;
    sharpe: number;
  }>;
  sensitivity: Array<{
    label: string;
    totalReturnPct: number;
    sharpeRatio: number;
    winRatePct: number;
  }>;
  lookAheadIntegrity: {
    causalReturnPct: number;
    shuffledReturnPct: number;
    passed: boolean;
    note: string;
  };
}
