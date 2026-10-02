import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { cacheKey, LocalStore, normalizeText } from '../src/cache.js';
import { makeMessage } from '../src/notify.js';
import { formatShow, formatShowWithId, laDay, ShowService, type Show } from '../src/shows.js';
import type { Config } from '../src/config.js';
import { poolOptions } from '../src/db.js';
import { lookupVenueNeighborhood } from '../src/mapbox.js';

const show: Show = {
  id: '833aeb44-3877-4ac2-ae16-7df4f408a951',
  artist: 'The Example Band', venue: 'The Echo',
  startsAt: '2026-10-03T04:00:00.000Z', ticketUrl: 'https://tickets.example/show?x=1&y=2',
  address: null, city: 'Los Angeles', neighborhood: 'Echo Park', genre: 'Rock', price: 20
};

const config: Config = {
  databaseUrl: 'postgresql://readonly@localhost/test', databaseSslNoVerify: false, geminiModel: 'gemini-2.5-flash',
  notifyBackends: ['console'], cacheTtlHours: 12, cacheDbPath: ':memory:',
  mcpHost: '127.0.0.1', mcpPort: 3000
};

test('LA date parsing rejects invalid dates and crosses DST correctly', () => {
  assert.throws(() => laDay('2026-02-30'));
  assert.equal(laDay('2026-03-08').toUTC().toISO(), '2026-03-08T08:00:00.000Z');
  assert.equal(laDay('2026-03-09').toUTC().toISO(), '2026-03-09T07:00:00.000Z');
});

test('cache keys are stable after filter canonicalization', () => {
  assert.equal(normalizeText('  ECHO  Park '), 'echo park');
  assert.equal(cacheKey('search_shows', { b: 20, a: 'x' }), cacheKey('search_shows', { a: 'x', b: 20 }));
});

test('SSL bypass is opt-in and removes URL SSL settings before passing pg ssl', () => {
  const original = 'postgresql://reader:secret@db.example/postgres?sslmode=require';
  assert.equal(poolOptions({ ...config, databaseUrl: original }).connectionString, original);
  const options = poolOptions({ ...config, databaseUrl: original, databaseSslNoVerify: true });
  assert.equal(new URL(options.connectionString!).searchParams.has('sslmode'), false);
  assert.deepEqual(options.ssl, { rejectUnauthorized: false });
});

test('machine email is persistent and cannot be switched through MCP', () => {
  const folder = mkdtempSync(join(tmpdir(), 'letsgetdown-test-'));
  const path = join(folder, 'cache.sqlite');
  const first = new LocalStore(path);
  assert.equal(first.registerEmail('me@example.com'), 'saved');
  first.close();
  const second = new LocalStore(path);
  assert.equal(second.getEmail(), 'me@example.com');
  assert.equal(second.registerEmail('me@example.com'), 'already-saved');
  assert.throws(() => second.registerEmail('someone@example.com'));
  second.close();
});

test('compact line and email include full URL and escaped HTML', () => {
  assert.match(formatShow(show), /^Fri 10\/2, 9pm, The Example Band @ The Echo, Echo Park, \$20, https:/);
  assert.equal(formatShowWithId(show), `${formatShow(show)} | show_id=${show.id}`);
  const message = makeMessage('me@example.com', [show], '<hi>');
  assert.match(message.text, /https:\/\/tickets\.example\/show\?x=1&y=2/);
  assert.match(message.html, /&lt;hi&gt;/);
  assert.match(message.html, /x=1&amp;y=2/);
});

test('search uses fixed parameterized SQL, includes unknown price, caps results', async () => {
  const store = new LocalStore(':memory:');
  let calls = 0;
  const fakePool = {
    query: async (sql: string, params: unknown[]) => {
      calls++;
      assert.match(sql, /s\.date >= \$1 AND s\.date < \$2 AND s\.date >= \$3/);
      assert.equal(params.length, 3);
      return { rows: Array.from({ length: 22 }, (_, n) => ({
        id: `833aeb44-3877-4ac2-ae16-${String(n).padStart(12, '0')}`,
        artist: 'Artist', venue: 'Venue', date: DateTime.now().plus({ days: 2, minutes: n }).toJSDate(),
        tickets_url: null, full_address: null, city: 'Los Angeles'
      })) };
    },
    end: async () => {}
  };
  const service = new ShowService(config, store, fakePool as never);
  const day = DateTime.now().setZone('America/Los_Angeles').plus({ days: 2 }).toISODate()!;
  const first = await service.search({ start_date: day, end_date: day, max_price: 10 });
  const second = await service.search({ start_date: day, end_date: day, max_price: 10 });
  assert.equal(first.length, 20);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  store.close();
});

test('Mapbox venue lookup accepts an exact LA POI and rejects a different venue', async () => {
  const fakeFetch = (async (url: URL) => {
    assert.equal(url.pathname, '/search/searchbox/v1/forward');
    assert.equal(url.searchParams.get('types'), 'poi');
    return { ok: true, json: async () => ({ features: [{ properties: {
      feature_type: 'poi', name: 'The Echo',
      context: { neighborhood: { name: 'Echo Park' }, region: { region_code: 'CA' } }
    } }] }) } as Response;
  }) as typeof fetch;
  assert.equal(await lookupVenueNeighborhood('The Echo', null, 'test-token', fakeFetch), 'Echo Park');
  assert.equal(await lookupVenueNeighborhood('Another Echo', null, 'test-token', fakeFetch), null);
});

test('Mapbox venue lookup accepts an optional leading The', async () => {
  const fakeFetch = (async () => ({ ok: true, json: async () => ({ features: [{ properties: {
    feature_type: 'poi', name: 'The Fonda Theatre',
    context: { neighborhood: { name: 'Hollywood' }, region: { region_code: 'CA' }, country: { country_code: 'US' } }
  } }] }) } as Response)) as typeof fetch;
  assert.equal(await lookupVenueNeighborhood('Fonda Theatre', null, 'test-token', fakeFetch), 'Hollywood');
  assert.equal(await lookupVenueNeighborhood('Fonda Theatre Annex', null, 'test-token', fakeFetch), null);
});

test('shows_tonight adds Mapbox neighborhood without caching the Mapbox result', async () => {
  const store = new LocalStore(':memory:');
  const originalFetch = globalThis.fetch;
  let mapboxCalls = 0;
  let dbCalls = 0;
  globalThis.fetch = (async () => {
    mapboxCalls++;
    return { ok: true, json: async () => ({ features: [{ properties: {
      feature_type: 'poi', name: 'The Echo', context: { neighborhood: { name: 'Echo Park' } }
    } }] }) } as Response;
  }) as typeof fetch;
  const fakePool = {
    query: async () => {
      dbCalls++;
      return { rows: [{
        id: show.id, artist: show.artist, venue: show.venue,
        date: new Date(Date.now() + 60 * 60_000), tickets_url: null,
        full_address: null, city: null
      }] };
    },
    end: async () => {}
  };
  try {
    const service = new ShowService({ ...config, mapboxAccessToken: 'test-token' }, store, fakePool as never);
    assert.equal((await service.tonight())[0]?.neighborhood, 'Echo Park');
    assert.equal((await service.tonight())[0]?.neighborhood, 'Echo Park');
    assert.equal(dbCalls, 1);
    assert.equal(mapboxCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
});

test('search_shows filters on Mapbox neighborhood without caching it', async () => {
  const store = new LocalStore(':memory:');
  const originalFetch = globalThis.fetch;
  let mapboxCalls = 0;
  let dbCalls = 0;
  globalThis.fetch = (async () => {
    mapboxCalls++;
    return { ok: true, json: async () => ({ features: [{ properties: {
      feature_type: 'poi', name: 'The Fonda Theatre', context: { neighborhood: { name: 'Hollywood' } }
    } }] }) } as Response;
  }) as typeof fetch;
  const day = DateTime.now().setZone('America/Los_Angeles').plus({ days: 2 }).toISODate()!;
  const fakePool = {
    query: async () => {
      dbCalls++;
      return { rows: [{
        id: show.id, artist: show.artist, venue: 'Fonda Theatre',
        date: DateTime.fromISO(day, { zone: 'America/Los_Angeles' }).set({ hour: 20 }).toJSDate(),
        tickets_url: null, full_address: null, city: null
      }] };
    },
    end: async () => {}
  };
  try {
    const service = new ShowService({ ...config, mapboxAccessToken: 'test-token' }, store, fakePool as never);
    const filters = { start_date: day, end_date: day, neighborhood: 'Hollywood', max_price: 20 };
    assert.equal((await service.search(filters))[0]?.neighborhood, 'Hollywood');
    assert.equal((await service.search(filters))[0]?.neighborhood, 'Hollywood');
    assert.equal(dbCalls, 1);
    assert.equal(mapboxCalls, 2);
    const cached = store.get<Show[]>(cacheKey('search_shows', { ...filters, neighborhood: 'hollywood' }));
    assert.equal(cached?.[0]?.neighborhood, null);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
});
