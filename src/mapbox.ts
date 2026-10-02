import { normalizeText } from './cache.js';

interface SearchBoxResponse {
  features?: Array<{ properties?: {
    feature_type?: string;
    name?: string;
    context?: {
      neighborhood?: { name?: string };
      region?: { region_code?: string };
      country?: { country_code?: string };
    };
  } }>;
}

function comparableVenueName(value?: string): string | undefined {
  return normalizeText(value)?.replace(/^the /, '');
}

// Search Box results are temporary-use only. Do not persist this value in the MCP cache.
export async function lookupVenueNeighborhood(
  venue: string,
  city: string | null,
  token: string,
  fetcher: typeof fetch = fetch
): Promise<string | null> {
  if (!venue || venue === 'Venue unknown' || venue.length > 150) return null;
  const url = new URL('https://api.mapbox.com/search/searchbox/v1/forward');
  url.searchParams.set('q', `${venue}, ${city || 'Los Angeles'}, CA`);
  url.searchParams.set('types', 'poi');
  url.searchParams.set('proximity', '-118.2437,34.0522');
  url.searchParams.set('country', 'US');
  url.searchParams.set('limit', '1');
  url.searchParams.set('access_token', token);

  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const body = await response.json() as SearchBoxResponse;
    const properties = body.features?.[0]?.properties;
    if (properties?.feature_type !== 'poi' || comparableVenueName(properties.name) !== comparableVenueName(venue)) return null;
    if (properties.context?.region?.region_code && properties.context.region.region_code !== 'CA') return null;
    if (properties.context?.country?.country_code && properties.context.country.country_code !== 'US') return null;
    const neighborhood = properties.context?.neighborhood?.name?.trim();
    return neighborhood && neighborhood.length <= 80 ? neighborhood : null;
  } catch {
    return null;
  }
}
