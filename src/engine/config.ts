import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { AppConfig } from './types.ts';

const CONFIG_PATH = path.resolve(process.cwd(), 'config.yaml');

let cachedConfig: AppConfig | null = null;

const DEFAULT_CRYPTO_FUTURES: AppConfig['crypto_futures'] = {
  enabled_by_default: false,
  default_leverage: 3,
  max_leverage: 20,
  margin_mode: 'isolated',
  taker_fee_bps: 5,
  maintenance_margin_rate: 0.005,
};

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = YAML.parse(raw) as AppConfig;
  cachedConfig = {
    ...parsed,
    backtest: {
      ...parsed.backtest,
      crypto_futures_cost_bps: parsed.backtest?.crypto_futures_cost_bps ?? 5,
    },
    crypto_futures: {
      ...DEFAULT_CRYPTO_FUTURES,
      ...(parsed.crypto_futures ?? {}),
    },
  };
  return cachedConfig;
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next: AppConfig = {
    universe: { ...current.universe, ...(partial.universe ?? {}) },
    filters: { ...current.filters, ...(partial.filters ?? {}) },
    regime: { ...current.regime, ...(partial.regime ?? {}) },
    scoring_weights: { ...current.scoring_weights, ...(partial.scoring_weights ?? {}) },
    scoring_thresholds: { ...current.scoring_thresholds, ...(partial.scoring_thresholds ?? {}) },
    risk: { ...current.risk, ...(partial.risk ?? {}) },
    backtest: { ...current.backtest, ...(partial.backtest ?? {}) },
    crypto_futures: { ...current.crypto_futures, ...(partial.crypto_futures ?? {}) },
  };
  fs.writeFileSync(CONFIG_PATH, YAML.stringify(next), 'utf-8');
  cachedConfig = next;
  return next;
}

export function reloadConfig(): AppConfig {
  cachedConfig = null;
  return loadConfig();
}
