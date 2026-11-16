import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { AppConfig } from './types.ts';

const CONFIG_PATH = path.resolve(process.cwd(), 'config.yaml');

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  cachedConfig = YAML.parse(raw) as AppConfig;
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
  };
  fs.writeFileSync(CONFIG_PATH, YAML.stringify(next), 'utf-8');
  cachedConfig = next;
  return next;
}

export function reloadConfig(): AppConfig {
  cachedConfig = null;
  return loadConfig();
}
