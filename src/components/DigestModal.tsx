import { Check, Copy, Download, Send, X } from 'lucide-react';
import { useState } from 'react';

interface Props {
  digestText: string;
  onClose: () => void;
}

export function DigestModal({ digestText, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(digestText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([digestText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-signals-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendTelegram = async () => {
    setSending(true);
    setTelegramStatus(null);
    try {
      const res = await fetch('/api/digest/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digestText }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Telegram request failed');
      setTelegramStatus(data.message);
    } catch (err) {
      setTelegramStatus(err instanceof Error ? err.message : 'Telegram delivery failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-[1px]">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 font-display">
            Morning Signal Digest
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close digest"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <pre className="p-4 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono leading-relaxed text-slate-800 dark:text-slate-200 overflow-x-auto max-h-96 whitespace-pre-wrap">
            {digestText}
          </pre>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy Digest'}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Download .txt
              </button>
            </div>

            <button
              type="button"
              onClick={handleSendTelegram}
              disabled={sending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              {sending ? 'Sending...' : 'Send to Telegram'}
            </button>
          </div>

          {telegramStatus && (
            <p className="text-xs text-slate-600 dark:text-slate-400">{telegramStatus}</p>
          )}
        </div>
      </div>
    </div>
  );
}
