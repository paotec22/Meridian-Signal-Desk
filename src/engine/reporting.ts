import type { RegimeStatus, SignalRecord } from './types.ts';

export function formatMorningDigest(
  asOfDate: string,
  regime: RegimeStatus,
  signals: SignalRecord[]
): string {
  const actionable = signals
    .filter((s) => s.direction !== 'avoid')
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const lines: string[] = [
    `Daily Signals | ${new Date().toISOString().slice(0, 10)} (data as of close ${asOfDate})`,
    `Regime: ${regime.summary}`,
    '',
  ];

  if (actionable.length === 0) {
    lines.push('No setups met minimum conviction and R:R criteria today.');
  } else {
    actionable.forEach((s, idx) => {
      lines.push(
        `${idx + 1}. ${s.symbol} (${s.asset_class}) ${s.direction.toUpperCase()} score ${s.score}`
      );
      lines.push(
        `   Entry ${s.entry_low}-${s.entry_high} | Stop ${s.stop_loss} | Target ${s.take_profit} | R:R ${s.risk_reward} | Size ${s.position_pct}%`
      );
      lines.push(`   Why: ${s.reasons.slice(0, 4).join(', ')}`);
      lines.push('');
    });
  }

  lines.push('Not financial advice. Signals are informational and can lose money.');
  return lines.join('\n');
}

export async function sendTelegramDigest(digestText: string): Promise<{
  sent: boolean;
  message: string;
}> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return {
      sent: false,
      message: 'Telegram Bot Token / Chat ID not configured in environment secrets. Digest formatted for manual copy.',
    };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: digestText,
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
  return { sent: true, message: 'Morning digest delivered via Telegram Bot.' };
}
