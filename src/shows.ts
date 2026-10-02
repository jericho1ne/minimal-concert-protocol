import { DateTime } from 'luxon';
import { Pool } from 'pg';
import { cacheKey, LocalStore, normalizeText } from './cache.js';
import type { Config } from './config.js';
import { poolOptions } from './db.js';
import { enrichShows } from './enrich.js';
import { lookupVenueNeighborhood } from './mapbox.js';

export const LA_ZONE = 'America/Los_Angeles';

export interface Show {
  id: string;
  artist: string;
  venue: string;
  startsAt: string;
  ticketUrl: string | null;
  address: string | null;
  city: string | null;
  neighborhood: string | null;
  genre: string | null;
  price: number | null;
}

interface DbRow {
  id: string;
  artist: string;
  venue: string | null;
  date: Date;
  tickets_url: string | null;
  full_address: string | null;
  city: string | null;
}

export interface SearchFilters {
  start_date: string;
  end_date: string;
  neighborhood?: string;
  genre?: string;
  max_price?: number;
}

export function laDay(value: string): DateTime {
  const date = DateTime.fromISO(value, { zone: LA_ZONE });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !date.isValid || date.toISODate() !== value) {
    throw new Error('Dates must be valid YYYY-MM-DD calendar dates');
  }
  return date.startOf('day');
}

export function formatShow(show: Show, includeTicketUrl = true): string {
  const oneLine = (value: string): string => value.replace(/[\r\n\t\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const when = DateTime.fromISO(show.startsAt).setZone(LA_ZONE);
  const day = when.toFormat('ccc M/d');
  const time = when.toFormat('h:mma').toLowerCase().replace(':00', '');
  const price = show.price === null ? 'price unknown' : `$${show.price}`;
  const details = `${day}, ${time}, ${oneLine(show.artist)} @ ${oneLine(show.venue)}, ${oneLine(show.neighborhood ?? show.city ?? 'neighborhood unknown')}, ${price}`;
  return includeTicketUrl ? `${details}, ${show.ticketUrl ?? 'ticket link unavailable'}` : details;
}

export function formatShowWithId(show: Show): string {
  return `${formatShow(show)} | show_id=${show.id}`;
}

function fromRow(row: DbRow): Show {
  let ticketUrl: string | null = null;
  if (row.tickets_url) {
    try {
      const url = new URL(row.tickets_url);
      if (url.protocol === 'https:' && !url.username && !url.password) ticketUrl = url.toString();
    } catch { /* Ignore unsafe or malformed ticket links. */ }
  }
  return {
    id: row.id,
    artist: row.artist,
    venue: row.venue || 'Venue unknown',
    startsAt: new Date(row.date).toISOString(),
    ticketUrl,
    address: row.full_address,
    city: row.city,
    neighborhood: null,
    genre: null,
    price: null
  };
}

const BASE_SELECT = `SELECT s.id, s.artist, COALESCE(v.name, s.raw_venue_name) AS venue,
  s.date, s.tickets_url, s.full_address, v.city
  FROM public.liveshows AS s
  LEFT JOIN public.venues AS v ON v.id = COALESCE(s.venue_uuid, s.venue_id)`;

export class ShowService {
  private pool: Pool;
  constructor(private config: Config, private store: LocalStore, pool?: Pool) {
    this.pool = pool ?? new Pool(poolOptions(config));
  }

  async search(filters: SearchFilters): Promise<Show[]> {
    if (filters.max_price !== undefined && (!Number.isFinite(filters.max_price) || filters.max_price < 0)) throw new Error('max_price must be nonnegative');
    const shows = await this.searchCandidates(filters);
    return this.selectShows(shows, normalizeText(filters.neighborhood), normalizeText(filters.genre), filters.max_price);
  }

  private async searchCandidates(filters: SearchFilters): Promise<Show[]> {
    const start = laDay(filters.start_date);
    const end = laDay(filters.end_date);
    if (end < start || end.diff(start, 'days').days > 31) throw new Error('Date range must be 0–31 days');
    const neighborhood = normalizeText(filters.neighborhood);
    const genre = normalizeText(filters.genre);
    const key = cacheKey('search_shows', {
      start_date: filters.start_date,
      end_date: filters.end_date,
      neighborhood,
      genre,
      max_price: filters.max_price
    });
    let shows = this.store.get<Show[]>(key);
    if (!shows) {
      const from = start.toUTC().toISO();
      const to = end.plus({ days: 1 }).toUTC().toISO();
      const result = await this.pool.query<DbRow>(
        `${BASE_SELECT} WHERE s.date >= $1 AND s.date < $2 AND s.date >= $3 ORDER BY s.date ASC LIMIT 100`,
        [from, to, new Date().toISOString()]
      );
      shows = await enrichShows(result.rows.map(fromRow), this.config);
      this.store.put(key, shows, this.config.cacheTtlHours);
    }
    return shows;
  }

  async tonight(neighborhood?: string): Promise<Show[]> {
    const today = DateTime.now().setZone(LA_ZONE).toISODate()!;
    const wanted = normalizeText(neighborhood);
    const key = cacheKey('shows_tonight', { la_date: today, neighborhood: wanted, version: 'mapbox-response-only' });
    let shows = this.store.get<Show[]>(key);
    if (!shows) {
      shows = await this.searchCandidates({ start_date: today, end_date: today });
      // Cache the DB/Gemini result only; Mapbox data is added to response copies below.
      this.store.put(key, shows, this.config.cacheTtlHours);
    }
    return this.selectShows(shows, wanted);
  }

  private async selectShows(shows: Show[], wanted?: string, genre?: string, maxPrice?: number): Promise<Show[]> {
    const resolved = new Map<string, string | null>();
    const matches: Show[] = [];
    for (const show of shows) {
      if (new Date(show.startsAt).getTime() < Date.now()) continue;
      if (genre && !normalizeText(show.genre ?? undefined)?.includes(genre)) continue;
      if (maxPrice !== undefined && show.price !== null && show.price > maxPrice) continue;
      let enriched = show;
      if (!show.neighborhood && this.config.mapboxAccessToken) {
        const venueKey = `${normalizeText(show.venue)}|${normalizeText(show.city ?? undefined)}`;
        if (!resolved.has(venueKey)) {
          resolved.set(venueKey, await lookupVenueNeighborhood(show.venue, show.city, this.config.mapboxAccessToken));
        }
        enriched = { ...show, neighborhood: resolved.get(venueKey) ?? null };
      }
      if (!wanted || normalizeText(enriched.neighborhood ?? undefined) === wanted) matches.push(enriched);
      if (matches.length === 20) break;
    }
    return matches;
  }

  async get(showId: string): Promise<Show | undefined> {
    const key = cacheKey('get_show', { show_id: showId });
    const cached = this.store.get<Show>(key);
    if (cached) return cached;
    return this.getFresh(showId);
  }

  async getFresh(showId: string): Promise<Show | undefined> {
    const result = await this.pool.query<DbRow>(`${BASE_SELECT} WHERE s.id = $1 LIMIT 1`, [showId]);
    if (!result.rows[0]) return undefined;
    const show = (await enrichShows([fromRow(result.rows[0])], this.config))[0];
    this.store.put(cacheKey('get_show', { show_id: showId }), show, this.config.cacheTtlHours);
    return show;
  }

  async close(): Promise<void> { await this.pool.end(); }
}
