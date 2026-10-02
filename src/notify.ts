import type { Config } from './config.js';
import type { Show } from './shows.js';
import { formatShow } from './shows.js';

export interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Notifier {
  send(message: Message): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  async send(message: Message): Promise<void> {
    console.error(`[letsgetdown email preview] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}

export class ResendNotifier implements Notifier {
  constructor(private apiKey: string, private from: string) {}

  async send(message: Message): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json() as { name?: unknown; message?: unknown };
        const name = typeof body.name === 'string' && /^[a-z_]{1,50}$/.test(body.name) ? body.name : '';
        const message = typeof body.message === 'string' ? body.message
          .replace(/re_[A-Za-z0-9_-]{8,}/g, '[redacted key]')
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
          .replace(/https?:\/\/\S+/gi, '[url]')
          .replace(/[\r\n\t\u0000-\u001f<>]/g, ' ')
          .trim().slice(0, 300) : '';
        detail = [name, message].filter(Boolean).join(': ');
      } catch { /* Keep the HTTP status when Resend sends no JSON error body. */ }
      throw new Error(`Resend rejected email (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
    }
  }
}

export function createNotifiers(config: Config): Notifier[] {
  return config.notifyBackends.map(backend => {
    if (backend === 'console') return new ConsoleNotifier();
    if (!config.resendApiKey || !config.emailFrom) throw new Error('RESEND_API_KEY and EMAIL_FROM are required for the resend backend');
    return new ResendNotifier(config.resendApiKey, config.emailFrom);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function makeMessage(to: string, shows: Show[], note?: string): Message {
  const lines = shows.map(formatShow);
  const subject = shows.length === 1 ? `Show alert: ${shows[0].artist}` : `Let's Get Down: ${shows.length} shows`;
  const text = [note?.trim(), ...lines].filter(Boolean).join('\n\n');
  const links = shows.map(show => {
    const label = `${show.artist} @ ${show.venue}`;
    const href = show.ticketUrl;
    return `<li>${escapeHtml(formatShow(show))}${href ? ` — <a href="${escapeHtml(href)}">Tickets for ${escapeHtml(label)}</a>` : ''}</li>`;
  }).join('');
  const html = `${note ? `<p>${escapeHtml(note)}</p>` : ''}<ul>${links}</ul>`;
  return { to, subject, text, html };
}

export async function deliver(notifiers: Notifier[], message: Message): Promise<void> {
  if (notifiers.length === 0) throw new Error('No notification backend configured');
  await Promise.all(notifiers.map(notifier => notifier.send(message)));
}
