import { loadConfig } from './config.ts';
import { getDb, upsertAsset } from './db.ts';
import type { AssetClass, AssetRow } from './types.ts';

export interface UniverseEntry {
  symbol: string;
  name: string;
  asset_class: AssetClass;
  sector: string;
  source: 'yahoo' | 'crypto';
}

export const CORE_UNIVERSE: UniverseEntry[] = [
  // Benchmarks (used for regime filter & relative strength)
  { symbol: '^GSPC', name: 'S&P 500 Index', asset_class: 'benchmark', sector: 'Index', source: 'yahoo' },
  { symbol: 'DX-Y.NYB', name: 'US Dollar Index', asset_class: 'benchmark', sector: 'Currency', source: 'yahoo' },

  // Equities — S&P 500 Cross-Sector Leaders
  { symbol: 'AAPL', name: 'Apple Inc.', asset_class: 'stock', sector: 'Technology', source: 'yahoo' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', asset_class: 'stock', sector: 'Technology', source: 'yahoo' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', asset_class: 'stock', sector: 'Semiconductors', source: 'yahoo' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', asset_class: 'stock', sector: 'Semiconductors', source: 'yahoo' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', asset_class: 'stock', sector: 'Semiconductors', source: 'yahoo' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', asset_class: 'stock', sector: 'Consumer Discretionary', source: 'yahoo' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', asset_class: 'stock', sector: 'Communication Services', source: 'yahoo' },
  { symbol: 'META', name: 'Meta Platforms Inc.', asset_class: 'stock', sector: 'Communication Services', source: 'yahoo' },
  { symbol: 'NFLX', name: 'Netflix Inc.', asset_class: 'stock', sector: 'Communication Services', source: 'yahoo' },
  { symbol: 'TSLA', name: 'Tesla Inc.', asset_class: 'stock', sector: 'Consumer Discretionary', source: 'yahoo' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', asset_class: 'stock', sector: 'Financials', source: 'yahoo' },
  { symbol: 'GS', name: 'Goldman Sachs Group', asset_class: 'stock', sector: 'Financials', source: 'yahoo' },
  { symbol: 'V', name: 'Visa Inc.', asset_class: 'stock', sector: 'Financials', source: 'yahoo' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway B', asset_class: 'stock', sector: 'Financials', source: 'yahoo' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', asset_class: 'stock', sector: 'Healthcare', source: 'yahoo' },
  { symbol: 'UNH', name: 'UnitedHealth Group', asset_class: 'stock', sector: 'Healthcare', source: 'yahoo' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', asset_class: 'stock', sector: 'Healthcare', source: 'yahoo' },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', asset_class: 'stock', sector: 'Energy', source: 'yahoo' },
  { symbol: 'CVX', name: 'Chevron Corp.', asset_class: 'stock', sector: 'Energy', source: 'yahoo' },
  { symbol: 'SLB', name: 'SLB (Schlumberger)', asset_class: 'stock', sector: 'Energy', source: 'yahoo' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', asset_class: 'stock', sector: 'Industrials', source: 'yahoo' },
  { symbol: 'GE', name: 'GE Aerospace', asset_class: 'stock', sector: 'Industrials', source: 'yahoo' },
  { symbol: 'RTX', name: 'RTX Corporation', asset_class: 'stock', sector: 'Industrials', source: 'yahoo' },
  { symbol: 'COST', name: 'Costco Wholesale', asset_class: 'stock', sector: 'Consumer Staples', source: 'yahoo' },
  { symbol: 'WMT', name: 'Walmart Inc.', asset_class: 'stock', sector: 'Consumer Staples', source: 'yahoo' },
  { symbol: 'PG', name: 'Procter & Gamble', asset_class: 'stock', sector: 'Consumer Staples', source: 'yahoo' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', asset_class: 'stock', sector: 'Materials', source: 'yahoo' },
  { symbol: 'LIN', name: 'Linde plc', asset_class: 'stock', sector: 'Materials', source: 'yahoo' },
  { symbol: 'NEE', name: 'NextEra Energy', asset_class: 'stock', sector: 'Utilities', source: 'yahoo' },
  { symbol: 'PLD', name: 'Prologis Inc.', asset_class: 'stock', sector: 'Real Estate', source: 'yahoo' },

  // Commodities — 9 Core Futures from Phase 2 Plan
  { symbol: 'GC=F', name: 'Gold Futures', asset_class: 'commodity', sector: 'Precious Metals', source: 'yahoo' },
  { symbol: 'SI=F', name: 'Silver Futures', asset_class: 'commodity', sector: 'Precious Metals', source: 'yahoo' },
  { symbol: 'CL=F', name: 'WTI Crude Oil Futures', asset_class: 'commodity', sector: 'Energy Futures', source: 'yahoo' },
  { symbol: 'NG=F', name: 'Natural Gas Futures', asset_class: 'commodity', sector: 'Energy Futures', source: 'yahoo' },
  { symbol: 'HG=F', name: 'Copper Futures', asset_class: 'commodity', sector: 'Industrial Metals', source: 'yahoo' },
  { symbol: 'ZW=F', name: 'Wheat Futures', asset_class: 'commodity', sector: 'Agriculture', source: 'yahoo' },
  { symbol: 'ZC=F', name: 'Corn Futures', asset_class: 'commodity', sector: 'Agriculture', source: 'yahoo' },
  { symbol: 'ZS=F', name: 'Soybeans Futures', asset_class: 'commodity', sector: 'Agriculture', source: 'yahoo' },
  { symbol: 'KC=F', name: 'Coffee Futures', asset_class: 'commodity', sector: 'Softs', source: 'yahoo' },

  // Crypto — Top Liquid Non-Stablecoin Pairs vs USD/USDT
  { symbol: 'BTC-USD', name: 'Bitcoin', asset_class: 'crypto', sector: 'Layer 1', source: 'crypto' },
  { symbol: 'ETH-USD', name: 'Ethereum', asset_class: 'crypto', sector: 'Layer 1', source: 'crypto' },
  { symbol: 'SOL-USD', name: 'Solana', asset_class: 'crypto', sector: 'Layer 1', source: 'crypto' },
  { symbol: 'BNB-USD', name: 'BNB', asset_class: 'crypto', sector: 'Exchange', source: 'crypto' },
  { symbol: 'XRP-USD', name: 'XRP', asset_class: 'crypto', sector: 'Payments', source: 'crypto' },
  { symbol: 'ADA-USD', name: 'Cardano', asset_class: 'crypto', sector: 'Layer 1', source: 'crypto' },
  { symbol: 'AVAX-USD', name: 'Avalanche', asset_class: 'crypto', sector: 'Layer 1', source: 'crypto' },
  { symbol: 'LINK-USD', name: 'Chainlink', asset_class: 'crypto', sector: 'Infrastructure', source: 'crypto' },
  { symbol: 'DOGE-USD', name: 'Dogecoin', asset_class: 'crypto', sector: 'Payments', source: 'crypto' },
];

export function isExcludedCryptoToken(symbol: string): boolean {
  const cfg = loadConfig();
  const base = symbol.split('-')[0].toUpperCase();
  return cfg.universe.excluded_crypto_tokens.includes(base);
}

export function normalizeYahooTicker(rawSymbol: string): string {
  // e.g. BRK.B -> BRK-B per Phase 2 spec
  return rawSymbol.trim().toUpperCase().replace('.', '-');
}

export function syncUniverse(): AssetRow[] {
  const rows: AssetRow[] = [];
  for (const item of CORE_UNIVERSE) {
    if (item.asset_class === 'crypto' && isExcludedCryptoToken(item.symbol)) {
      continue;
    }
    rows.push(upsertAsset(item.symbol, item.name, item.asset_class, item.sector, item.source, 1));
  }
  return rows;
}

export function getActiveAssets(assetClass?: AssetClass): AssetRow[] {
  const db = getDb();
  if (assetClass) {
    return db
      .prepare('SELECT * FROM assets WHERE active = 1 AND asset_class = ? ORDER BY symbol ASC')
      .all(assetClass) as unknown as AssetRow[];
  }
  return db.prepare('SELECT * FROM assets WHERE active = 1 ORDER BY asset_class, symbol ASC').all() as unknown as AssetRow[];
}
