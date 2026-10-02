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

export interface NeighborhoodCount {
  neighborhood: string;
  shows: number;
}

export interface WeekendNeighborhoodCounts {
  startDate: string;
  endDate: string;
  totalShows: number;
  unresolvedShows: number;
  neighborhoods: NeighborhoodCount[];
}

interface NeighborhoodCandidate {
  venue: string;
  city: string | null;
  startsAt: string;
}

export function weekendWindow(now: DateTime = DateTime.now().setZone(LA_ZONE)): { start: DateTime; end: DateTime } {
  const local = now.setZone(LA_ZONE);
  const friday = local.weekday < 5
    ? local.plus({ days: 5 - local.weekday })
    : local.minus({ days: local.weekday - 5 });
  const start = friday.startOf('day');
  return { start, end: start.plus({ days: 3 }) };
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

  async weekendNeighborhoods(now: DateTime = DateTime.now().setZone(LA_ZONE)): Promise<WeekendNeighborhoodCounts> {
    if (!this.config.mapboxAccessToken) throw new Error('MAPBOX_ACCESS_TOKEN is required for neighborhood counts');
    const { start, end } = weekendWindow(now);
    const key = cacheKey('weekend_neighborhoods_db', { start_date: start.toISODate()!, version: 'raw-shows-v1' });
    let candidates = this.store.get<NeighborhoodCandidate[]>(key);
    if (!candidates) {
      const result = await this.pool.query<Pick<DbRow, 'venue' | 'city' | 'date'>>(
        `SELECT COALESCE(v.name, s.raw_venue_name) AS venue, v.city, s.date
         FROM public.liveshows AS s
         LEFT JOIN public.venues AS v ON v.id = COALESCE(s.venue_uuid, s.venue_id)
         WHERE s.date >= $1 AND s.date < $2 AND s.date >= $3 ORDER BY s.date ASC LIMIT 1001`,
        [start.toUTC().toISO(), end.toUTC().toISO(), now.toUTC().toISO()]
      );
      if (result.rows.length > 1000) throw new Error('Too many weekend shows to count accurately');
      candidates = result.rows.map(row => ({
        venue: row.venue || 'Venue unknown',
        city: row.city,
        startsAt: new Date(row.date).toISOString()
      }));
      // Search Box results are temporary-use only; only raw database rows are cached.
      this.store.put(key, candidates, this.config.cacheTtlHours);
    }

    const upcoming = candidates.filter(show => new Date(show.startsAt).getTime() >= now.toMillis());
    const venueKey = (show: NeighborhoodCandidate): string => JSON.stringify([
      normalizeText(show.venue)?.replace(/^the /, ''), normalizeText(show.city ?? undefined)
    ]);
    const venues = new Map<string, NeighborhoodCandidate>();
    for (const show of upcoming) venues.set(venueKey(show), show);
    if (venues.size > 100) throw new Error('Too many distinct weekend venues to resolve accurately');

    // Start no more than one Search Box request every 120 ms (under its default 10/s limit).
    const entries = [...venues];
    const lookedUp = await Promise.all(entries.map(async ([key, venue], index) => {
      if (index) await new Promise(resolve => setTimeout(resolve, index * 120));
      return [key, await lookupVenueNeighborhood(venue.venue, venue.city, this.config.mapboxAccessToken!)] as const;
    }));
    const names = new Map<string, string | null>(lookedUp);
    const counts = new Map<string, NeighborhoodCount>();
    let unresolvedShows = 0;
    for (const show of upcoming) {
      const neighborhood = names.get(venueKey(show));
      if (!neighborhood) { unresolvedShows++; continue; }
      const normalized = normalizeText(neighborhood)!;
      const count = counts.get(normalized) ?? { neighborhood, shows: 0 };
      count.shows++;
      counts.set(normalized, count);
    }
    return {
      startDate: start.toISODate()!,
      endDate: end.minus({ days: 1 }).toISODate()!,
      totalShows: upcoming.length,
      unresolvedShows,
      neighborhoods: [...counts.values()].sort((a, b) => b.shows - a.shows || a.neighborhood.localeCompare(b.neighborhood))
    };
  }

  private async selectShows(shows: Show[], wanted?: string, genre?: string, maxPrice?: number): Promise<Show[]> {
    const resolved = new Map<string, string | null>();
    const matches: Show[] = [];
    for (const show of shows) {
      if (new Date(show.startsAt).getTime() < Date.now()) continue;
      if (genre && !normalizeText(show.genre ?? undefined)?.includes(genre)) continue;
      if (maxPrice !== undefined && (show.price === null || show.price > maxPrice)) continue;
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
