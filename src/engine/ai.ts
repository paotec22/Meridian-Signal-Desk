import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { CryptoFuturesContractMeta, CryptoTradingMode, MarginMode, RegimeStatus, SignalRecord, Timeframe } from './types.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please check the Settings > Secrets panel.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface SignalResearchBrief {
  catalystSummary: string;
  bullCase: string[];
  bearRisks: string[];
  macroAlignment: string;
  riskVerdict: 'Aligned' | 'Elevated Event Risk' | 'Counter-Trend Caution';
  sources: Array<{ title: string; uri: string; publishedAt?: string }>;
  checkedAt: string;
  timeframe: Timeframe;
  notice?: string;
}

interface YahooNewsItem {
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
}

async function fetchYahooNews(symbol: string, name: string): Promise<YahooNewsItem[]> {
  try {
    const query = symbol.includes('=') || symbol.includes('-USD') ? name : symbol;
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=5&quotesCount=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MeridianSignalDesk/1.0)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      news?: Array<{
        title?: string;
        publisher?: string;
        link?: string;
        providerPublishTime?: number;
      }>;
    };
    return (data.news ?? [])
      .filter((n) => n.title && n.link)
      .slice(0, 5)
      .map((n) => ({
        title: n.title!,
        publisher: n.publisher ?? 'News',
        link: n.link!,
        publishedAt: n.providerPublishTime
          ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10)
          : '',
      }));
  } catch {
    return [];
  }
}

function parseJsonSafe(raw: string | undefined): Partial<Omit<SignalResearchBrief, 'sources'>> {
  if (!raw) return {};
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned) as Partial<Omit<SignalResearchBrief, 'sources'>>;
}

function buildSchemaConfig(useSearch: boolean, model: string) {
  const schema = {
    type: Type.OBJECT,
    properties: {
      catalystSummary: {
        type: Type.STRING,
        description: '2-3 sentence summary of recent news, earnings timing, and catalysts.',
      },
      bullCase: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Up to 3 concise supporting technical/fundamental factors.',
      },
      bearRisks: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Up to 3 concise invalidation triggers, earnings risks, or macro headwinds.',
      },
      macroAlignment: {
        type: Type.STRING,
        description: '1-2 sentences on how this trade fits the current S&P 500 / BTC / DXY regime.',
      },
      riskVerdict: {
        type: Type.STRING,
        description: 'Exactly one of: Aligned, Elevated Event Risk, Counter-Trend Caution',
      },
    },
    required: ['catalystSummary', 'bullCase', 'bearRisks', 'macroAlignment', 'riskVerdict'],
  };

  return {
    systemInstruction:
      'You are a skeptical institutional quantitative risk analyst. Verify upcoming earnings, macro catalysts, and technical alignment concisely in plain prose. Never guarantee profits.',
    ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
    ...(model === 'gemini-4-hydrogen' ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
    responseMimeType: 'application/json',
    responseSchema: schema,
  };
}

function buildDeterministicFallback(
  signal: SignalRecord,
  regime: RegimeStatus,
  news: YahooNewsItem[],
  indicatorsSummary: Record<string, number | null>,
  quotaNotice: string,
  timeframe: Timeframe,
  checkedAt: string
): SignalResearchBrief {
  const isCrypto = signal.asset_class === 'crypto';
  const regimeBullish = isCrypto ? regime.btcBullish : regime.sp500Bullish;
  const counterTrend =
    (signal.direction === 'long' && !regimeBullish) ||
    (signal.direction === 'short' && regimeBullish);

  const verdict: SignalResearchBrief['riskVerdict'] = counterTrend
    ? 'Counter-Trend Caution'
    : news.length > 0
    ? 'Aligned'
    : 'Elevated Event Risk';

  const rsiText = indicatorsSummary.rsi_14 != null ? `RSI(14) at ${indicatorsSummary.rsi_14.toFixed(1)}` : 'RSI momentum';
  const adxText = indicatorsSummary.adx_14 != null ? `ADX(14) at ${indicatorsSummary.adx_14.toFixed(1)}` : 'trend strength';

  const headlinesText =
    news.length > 0
      ? `Recent headlines for ${signal.symbol}: ${news
          .slice(0, 2)
          .map((n) => `"${n.title}" (${n.publisher}, ${n.publishedAt})`)
          .join('; ')}.`
      : `No recent news headlines retrieved for ${signal.symbol}; check upcoming earnings or macro releases manually before entry.`;

  return {
    catalystSummary: headlinesText,
    bullCase: signal.reasons.slice(0, 3),
    bearRisks: [
      `Stop-loss invalidation level at ${signal.stop_loss} (2x ATR risk guard).`,
      `${rsiText} and ${adxText} require confirmation on next-bar volume.`,
      counterTrend
        ? `Setup runs counter to primary ${isCrypto ? 'BTC' : 'S&P 500'} regime.`
        : 'Monitor upcoming CPI/FOMC or sector earnings announcements for gap risk.',
    ],
    macroAlignment: `Benchmark context (${timeframe.toUpperCase()}): ${regime.summary}.`,
    riskVerdict: verdict,
    sources: news.map((n) => ({
      title: `${n.publisher}: ${n.title}`,
      uri: n.link,
      publishedAt: n.publishedAt,
    })),
    checkedAt,
    timeframe,
    notice: quotaNotice,
  };
}

export interface FuturesAnalysisContext {
  mode: CryptoTradingMode;
  leverage: number;
  marginMode: MarginMode;
  contract?: CryptoFuturesContractMeta | null;
}

export async function analyzeSignalWithGemini(
  signal: SignalRecord,
  regime: RegimeStatus,
  indicatorsSummary: Record<string, number | null>,
  timeframe: Timeframe = '1d',
  futuresContext?: FuturesAnalysisContext
): Promise<SignalResearchBrief> {
  const checkedAt = new Date().toISOString();
  const news = await fetchYahooNews(signal.symbol, signal.name);
  const newsContext =
    news.length > 0
      ? `\nRecent News Headlines:\n${news.map((n) => `- [${n.publishedAt}] ${n.title} (${n.publisher})`).join('\n')}`
      : '';

  const perpLine =
    signal.asset_class === 'crypto' && futuresContext?.mode === 'futures'
      ? `\n- Execution Venue: Crypto Perpetual Futures (${futuresContext.contract?.perpSymbol ?? signal.symbol}, ${futuresContext.leverage}x ${futuresContext.marginMode} margin)` +
        (futuresContext.contract
          ? ` | Mark: ${futuresContext.contract.markPrice}, Basis: ${futuresContext.contract.basisPct}%, 8h Funding: ${futuresContext.contract.fundingRatePct}% (${futuresContext.contract.annualizedFundingPct}% ann.)`
          : '')
      : '';

  const prompt = `
Analyze the following ${timeframe.toUpperCase()} swing-trade setup generated by our deterministic rule-based engine (checked at ${checkedAt}):
- Asset: ${signal.symbol} (${signal.name}, ${signal.asset_class} / ${signal.sector})
- Timeframe: ${timeframe.toUpperCase()} | Latest Bar: ${signal.date} | Direction: ${signal.direction.toUpperCase()} | Rule Score: ${signal.score}/100
- Price: ${signal.close} | Entry Zone: ${signal.entry_low}-${signal.entry_high} | Stop Loss: ${signal.stop_loss} | Take Profit: ${signal.take_profit} (R:R ${signal.risk_reward}x)${perpLine}
- Market Regime: ${regime.summary}
- Quantitative Reasons: ${signal.reasons.join('; ')}
- Indicators: RSI(14)=${indicatorsSummary.rsi_14?.toFixed(1) ?? 'N/A'}, ADX(14)=${indicatorsSummary.adx_14?.toFixed(1) ?? 'N/A'}, ATR(14)=${indicatorsSummary.atr_14?.toFixed(3) ?? 'N/A'}, 3M Return=${indicatorsSummary.ret_3m != null ? (indicatorsSummary.ret_3m * 100).toFixed(1) + '%' : 'N/A'}${newsContext}

Assess recent news, upcoming earnings/event risk, perpetual funding/liquidation risk if applicable, and macro regime alignment. Return valid JSON matching the schema.
`;

  const ai = getAiClient();

  const attempts: Array<{ model: string; useSearch: boolean }> = [
    { model: 'gemini-4-hydrogen', useSearch: true },
    { model: 'gemini-4-hydrogen', useSearch: false },
    { model: 'gemini-3.1-flash-lite', useSearch: false },
  ];

  let lastErr: unknown = null;

  for (const attempt of attempts) {
    try {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents: prompt,
        config: buildSchemaConfig(attempt.useSearch, attempt.model),
      });

      const parsed = parseJsonSafe(response.text);
      const groundingChunks =
        (response.candidates?.[0]?.groundingMetadata?.groundingChunks as
          | Array<{ web?: { title?: string; uri?: string } }>
          | undefined) ?? [];

      const searchSources = groundingChunks
        .filter((c) => c.web?.uri)
        .slice(0, 5)
        .map((c) => ({
          title: c.web?.title ?? c.web?.uri ?? 'Source',
          uri: c.web!.uri!,
        }));

      const sources =
        searchSources.length > 0
          ? searchSources
          : news.map((n) => ({
              title: `${n.publisher}: ${n.title}`,
              uri: n.link,
              publishedAt: n.publishedAt,
            }));

      return {
        catalystSummary: parsed.catalystSummary ?? 'No catalyst summary available.',
        bullCase: parsed.bullCase ?? [],
        bearRisks: parsed.bearRisks ?? [],
        macroAlignment: parsed.macroAlignment ?? '',
        riskVerdict:
          parsed.riskVerdict === 'Elevated Event Risk' || parsed.riskVerdict === 'Counter-Trend Caution'
            ? parsed.riskVerdict
            : 'Aligned',
        sources,
        checkedAt,
        timeframe,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
  const isAuth = msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID');

  const notice = isQuota
    ? 'Gemini API quota exceeded (429). Showing live Yahoo Finance news headlines and deterministic risk check. You can check your quota or select a billing-enabled API key in Settings > Secrets.'
    : isAuth
    ? 'Gemini API key permission error (403). Showing live Yahoo Finance news headlines and deterministic risk check. Verify your API key in Settings > Secrets.'
    : 'AI synthesis temporarily unavailable. Showing live Yahoo Finance news headlines and deterministic risk check.';

  return buildDeterministicFallback(signal, regime, news, indicatorsSummary, notice, timeframe, checkedAt);
}
