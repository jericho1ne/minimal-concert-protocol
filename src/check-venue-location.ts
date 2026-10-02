// One-off live diagnostic; does not update venues, show results, or the MCP cache.
import { Pool } from 'pg';
import { loadConfig } from './config.js';
import { poolOptions } from './db.js';

interface VenueRow {
  venue: string;
  city: string | null;
}

interface MapboxResponse {
  features?: Array<{ properties?: {
    feature_type?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    context?: {
      neighborhood?: { name?: string };
      region?: { region_code?: string };
      country?: { country_code?: string };
    };
  } }>;
}

async function main(): Promise<void> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('Add MAPBOX_ACCESS_TOKEN to .env first');
  const requestedVenue = process.argv.slice(2).join(' ').trim() || 'The Echo';

  const pool = new Pool({ ...poolOptions(loadConfig()), max: 1, connectionTimeoutMillis: 8000 });
  let venue: VenueRow;
  try {
    const result = await pool.query<VenueRow>(
      `SELECT COALESCE(v.name, s.raw_venue_name) AS venue, v.city
       FROM public.liveshows AS s
       LEFT JOIN public.venues AS v ON v.id = COALESCE(s.venue_uuid, s.venue_id)
       WHERE lower(COALESCE(v.name, s.raw_venue_name)) = lower($1)
       ORDER BY CASE WHEN s.date >= now() THEN 0 ELSE 1 END, s.date DESC
       LIMIT 1`,
      [requestedVenue]
    );
    if (!result.rows[0]) throw new Error(`No show found at venue: ${requestedVenue}`);
    venue = result.rows[0];
  } finally {
    await pool.end();
  }

  const url = new URL('https://api.mapbox.com/search/searchbox/v1/forward');
  url.searchParams.set('q', `${venue.venue}, ${venue.city || 'Los Angeles'}, CA`);
  url.searchParams.set('types', 'poi');
  url.searchParams.set('proximity', '-118.2437,34.0522');
  url.searchParams.set('country', 'US');
  url.searchParams.set('limit', '1');
  url.searchParams.set('access_token', token);

  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Mapbox returned HTTP ${response.status}`);
  const body = await response.json() as MapboxResponse;
  const match = body.features?.find(feature => feature.properties?.feature_type === 'poi');
  console.log(JSON.stringify({
    venue: venue.venue,
    city: venue.city,
    mapbox_type: match?.properties?.feature_type ?? null,
    mapbox_name: match?.properties?.name ?? null,
    name_matches: match?.properties?.name?.trim().toLowerCase().replace(/^the /, '') ===
      venue.venue.trim().toLowerCase().replace(/^the /, ''),
    mapbox_address: match?.properties?.full_address ?? null,
    mapbox_place: match?.properties?.place_formatted ?? null,
    neighborhood: match?.properties?.context?.neighborhood?.name ?? null,
    region_code: match?.properties?.context?.region?.region_code ?? null,
    country_code: match?.properties?.context?.country?.country_code ?? null
  }));
}

main().catch(error => {
  // Never print request URLs: Mapbox puts the token in the query string.
  console.error(error instanceof Error ? error.message : 'Mapbox check failed');
  process.exitCode = 1;
});
