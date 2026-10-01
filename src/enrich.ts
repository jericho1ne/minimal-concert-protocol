import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { Config } from './config.js';
import type { Show } from './shows.js';

interface GeminiResponse { candidates?: { content?: { parts?: { text?: string }[] } }[] }

async function classify(show: Show, config: Config): Promise<Pick<Show, 'genre' | 'neighborhood'>> {
  if (!config.geminiApiKey) return { genre: null, neighborhood: null };
  const prompt = `Classify this Los Angeles live show using only reliable knowledge. Return JSON with genre and neighborhood, each a short string or null when uncertain. Do not guess. Artist: ${show.artist}. Venue: ${show.venue}. Address: ${show.address ?? 'unknown'}. City: ${show.city ?? 'unknown'}.`;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': config.geminiApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { genre: null, neighborhood: null };
    const data = await response.json() as GeminiResponse;
    const output = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!output) return { genre: null, neighborhood: null };
    const parsed = JSON.parse(output) as { genre?: unknown; neighborhood?: unknown };
    const clean = (value: unknown): string | null => typeof value === 'string' && value.length <= 60 ? value.trim() || null : null;
    return { genre: clean(parsed.genre), neighborhood: clean(parsed.neighborhood) };
  } catch {
    return { genre: null, neighborhood: null };
  }
}

async function ticketPrice(ticketUrl: string | null): Promise<number | null> {
  if (!ticketUrl) return null;
  let url: URL;
  try { url = new URL(ticketUrl); } catch { return null; }
  if (url.protocol !== 'https:' || isIP(url.hostname) || url.username || url.password ||
      /(^localhost$|\.local$|\.internal$)/i.test(url.hostname)) return null;
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) return null;
    const response = await fetch(url, {
      redirect: 'error',
      headers: { 'user-agent': 'letsgetdown-mcp/0.1 (price metadata only)' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null;
    if (Number(response.headers.get('content-length')) > 1_000_000) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 1_000_000) {
      const { value, done } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    const match = html.match(/<meta[^>]+(?:product:price:amount|og:price:amount)[^>]+content=["']([0-9]+(?:\.[0-9]{1,2})?)["']/i)
      ?? html.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i);
    if (!match) return null;
    const price = Number(match[1]);
    return Number.isFinite(price) && price >= 0 && price <= 5000 ? price : null;
  } catch { return null; }
}

function isPublicAddress(address: string): boolean {
  if (address.includes(':')) {
    const lower = address.toLowerCase();
    return !(/^(::|fc|fd|fe8|fe9|fea|feb|ff)/.test(lower) || lower === '::1' || lower.startsWith('::ffff:'));
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
}

export async function enrichShows(shows: Show[], config: Config): Promise<Show[]> {
  const result = new Array<Show>(shows.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < shows.length) {
      const index = next++;
      const show = shows[index];
      const [classification, price] = await Promise.all([classify(show, config), ticketPrice(show.ticketUrl)]);
      result[index] = { ...show, ...classification, price };
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, shows.length) }, () => worker()));
  return result;
}
