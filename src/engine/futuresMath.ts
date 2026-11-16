export interface CryptoFuturesSizing {
  contractsQty: number;
  notionalUsd: number;
  initialMarginUsd: number;
  marginAllocPct: number;
  effectiveLeverage: number;
  liquidationPrice: number | null;
  stopSafeBeforeLiq: boolean;
  dailyFundingUsd: number;
  plannedDollarRisk: number;
}

function roundLevel(val: number): number {
  if (val >= 100) return Number(val.toFixed(2));
  if (val >= 1) return Number(val.toFixed(3));
  return Number(val.toFixed(5));
}

export function computeCryptoFuturesMetrics(params: {
  direction: 'long' | 'short' | 'avoid';
  entryPrice: number;
  stopLoss: number;
  equity: number;
  riskPct: number;
  maxPositionPct: number;
  leverage: number;
  marginMode: 'isolated' | 'cross';
  maintenanceMarginRate?: number;
  fundingRate8h?: number;
}): CryptoFuturesSizing {
  const {
    direction,
    entryPrice,
    stopLoss,
    equity,
    riskPct,
    maxPositionPct,
    leverage,
    marginMode,
    maintenanceMarginRate = 0.005,
    fundingRate8h = 0,
  } = params;

  const safeLev = Math.max(1, Math.min(50, leverage || 1));
  const riskPerUnit = Math.max(Math.abs(entryPrice - stopLoss), 1e-6);
  const dollarRiskTarget = equity * (riskPct / 100);

  const rawNotional = entryPrice > 0 ? (dollarRiskTarget / riskPerUnit) * entryPrice : 0;
  const maxMarginUsd = equity * (maxPositionPct / 100);
  const maxNotionalUsd = maxMarginUsd * safeLev;
  const notionalUsd = Math.min(rawNotional, maxNotionalUsd);

  const initialMarginUsd = notionalUsd / safeLev;
  const marginAllocPct = equity > 0 ? (initialMarginUsd / equity) * 100 : 0;
  const contractsQty = entryPrice > 0 ? notionalUsd / entryPrice : 0;
  const effectiveLeverage = equity > 0 ? notionalUsd / equity : 0;
  const plannedDollarRisk = contractsQty * riskPerUnit;

  let liquidationPrice: number | null = null;
  let stopSafeBeforeLiq = true;

  if (entryPrice > 0 && direction !== 'avoid') {
    const marginRatio =
      marginMode === 'isolated'
        ? 1 / safeLev
        : notionalUsd > 0
        ? Math.min(1, equity / notionalUsd)
        : 1;

    if (direction === 'long') {
      liquidationPrice = Math.max(0, entryPrice * (1 - marginRatio + maintenanceMarginRate));
      stopSafeBeforeLiq = stopLoss > liquidationPrice;
    } else {
      liquidationPrice = entryPrice * (1 + marginRatio - maintenanceMarginRate);
      stopSafeBeforeLiq = stopLoss < liquidationPrice;
    }
  }

  const dailyRate = fundingRate8h * 3;
  const dailyFundingUsd =
    direction === 'long'
      ? -notionalUsd * dailyRate
      : direction === 'short'
      ? notionalUsd * dailyRate
      : 0;

  return {
    contractsQty,
    notionalUsd,
    initialMarginUsd,
    marginAllocPct,
    effectiveLeverage,
    liquidationPrice: liquidationPrice != null ? roundLevel(liquidationPrice) : null,
    stopSafeBeforeLiq,
    dailyFundingUsd,
    plannedDollarRisk,
  };
}
