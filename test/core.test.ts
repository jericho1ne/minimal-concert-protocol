import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import Database from 'better-sqlite3';
import { cacheKey, LocalStore, normalizeText } from '../src/cache.js';
import { makeMessage, ResendNotifier } from '../src/notify.js';
import { formatShow, formatShowWithId, laDay, ShowService, weekendWindow, type Show } from '../src/shows.js';
import type { Config } from '../src/config.js';
import { poolOptions } from '../src/db.js';
import { lookupVenueNeighborhood } from '../src/mapbox.js';
import { createServer } from '../src/server.js';

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

test('discovery-only server exposes show tools but no personal or email tools', () => {
  const store = new LocalStore(':memory:');
  const shows = new ShowService(config, store);
  try {
    const publicServer = createServer(config, store, shows, { readOnly: true });
    const localServer = createServer(config, store, shows);
    for (const name of ['shows_tonight', 'search_shows', 'get_show', 'weekend_neighborhoods']) {
      assert.ok(publicServer.toolInputSchemaJson(name), `${name} should be public`);
    }
    for (const name of ['set_my_email', 'send_show_to_me', 'email_summary']) {
      assert.equal(publicServer.toolInputSchemaJson(name), undefined, `${name} must not be public`);
      assert.ok(localServer.toolInputSchemaJson(name), `${name} should remain available locally`);
    }
  } finally {
    store.close();
  }
});

test('LA date parsing rejects invalid dates and crosses DST correctly', () => {
  assert.throws(() => laDay('2026-02-30'));
  assert.equal(laDay('2026-03-08').toUTC().toISO(), '2026-03-08T08:00:00.000Z');
  assert.equal(laDay('2026-03-09').toUTC().toISO(), '2026-03-09T07:00:00.000Z');
});

test('weekend window stays on the current weekend and crosses DST in LA time', () => {
  const friday = weekendWindow(DateTime.fromISO('2026-10-30T12:00:00', { zone: 'America/Los_Angeles' }));
  assert.equal(friday.start.toISODate(), '2026-10-30');
  assert.equal(friday.end.toISODate(), '2026-11-02');
  assert.equal(friday.end.toUTC().diff(friday.start.toUTC(), 'hours').hours, 73);
  const sunday = weekendWindow(DateTime.fromISO('2026-11-01T22:00:00', { zone: 'America/Los_Angeles' }));
  assert.equal(sunday.start.toISODate(), '2026-10-30');
  const monday = weekendWindow(DateTime.fromISO('2026-11-02T12:00:00', { zone: 'America/Los_Angeles' }));
  assert.equal(monday.start.toISODate(), '2026-11-06');
});

test('weekend counts use all shows, resolve each venue once per request, and do not cache Mapbox results', async () => {
  const store = new LocalStore(':memory:');
  const originalFetch = globalThis.fetch;
  let dbCalls = 0;
  let mapboxCalls = 0;
  const now = DateTime.fromISO('2026-10-02T12:00:00', { zone: 'America/Los_Angeles' });
  const date = DateTime.fromISO('2026-10-03T20:00:00', { zone: 'America/Los_Angeles' }).toJSDate();
  const fakePool = {
    query: async (sql: string, params: unknown[]) => {
      dbCalls++;
      assert.match(sql, /s\.date >= \$1 AND s\.date < \$2 AND s\.date >= \$3/);
      assert.match(sql, /LIMIT 1001/);
      assert.deepEqual(params, [now.startOf('day').toUTC().toISO(), now.startOf('day').plus({ days: 3 }).toUTC().toISO(), now.toUTC().toISO()]);
      return { rows: [
        { venue: 'The Echo', city: 'Los Angeles', date },
        { venue: 'The Echo', city: 'Los Angeles', date },
        { venue: 'Lodge Room', city: 'Los Angeles', date },
        { venue: 'Unknown Venue', city: 'Los Angeles', date }
      ] };
    },
    end: async () => {}
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    mapboxCalls++;
    const query = new URL(String(input)).searchParams.get('q') ?? '';
    const name = query.startsWith('The Echo,') ? 'The Echo' : query.startsWith('Lodge Room,') ? 'Lodge Room' : 'Another Venue';
    const neighborhood = name === 'The Echo' ? 'Echo Park' : 'Highland Park';
    return { ok: true, json: async () => ({ features: [{ properties: {
      feature_type: 'poi', name, context: { neighborhood: { name: neighborhood }, region: { region_code: 'CA' }, country: { country_code: 'US' } }
    } }] }) } as Response;
  }) as typeof fetch;
  try {
    const service = new ShowService({ ...config, mapboxAccessToken: 'test-token' }, store, fakePool as never);
    const first = await service.weekendNeighborhoods(now);
    assert.equal(first.totalShows, 4);
    assert.equal(first.unresolvedShows, 1);
    assert.deepEqual(first.neighborhoods, [
      { neighborhood: 'Echo Park', shows: 2 },
      { neighborhood: 'Highland Park', shows: 1 }
    ]);
    assert.equal(dbCalls, 1);
    assert.equal(mapboxCalls, 3);
    await service.weekendNeighborhoods(now);
    assert.equal(dbCalls, 1);
    assert.equal(mapboxCalls, 6);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
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
  assert.throws(() => first.registerEmail('you@example.com'), /real recipient email/);
  assert.equal(first.registerEmail('me@letsgetdown.io'), 'saved');
  first.close();
  const second = new LocalStore(path);
  assert.equal(second.getEmail(), 'me@letsgetdown.io');
  assert.equal(second.registerEmail('me@letsgetdown.io'), 'already-saved');
  assert.throws(() => second.registerEmail('someone@letsgetdown.io'));
  assert.throws(() => second.correctPlaceholderEmail('someone@letsgetdown.io'), /No placeholder recipient/);
  second.close();
});

test('local-only correction replaces an example.com recipient once', () => {
  const folder = mkdtempSync(join(tmpdir(), 'letsgetdown-recipient-test-'));
  const path = join(folder, 'cache.sqlite');
  const initial = new LocalStore(path);
  initial.close();
  // Simulate an address saved by the earlier version of the MCP.
  const db = new Database(path);
  db.prepare("INSERT INTO settings (key, value) VALUES ('email', ?)").run('you@example.com');
  db.close();
  const store = new LocalStore(path);
  store.correctPlaceholderEmail('me@letsgetdown.io');
  assert.equal(store.getEmail(), 'me@letsgetdown.io');
  assert.throws(() => store.correctPlaceholderEmail('another@letsgetdown.io'), /No placeholder recipient/);
  store.close();
});

test('compact line and email include full URL and escaped HTML', () => {
  assert.match(formatShow(show), /^Fri 10\/2, 9pm, The Example Band @ The Echo, Echo Park, \$20, https:/);
  assert.equal(formatShowWithId(show), `${formatShow(show)} | show_id=${show.id}`);
  const message = makeMessage('me@example.com', [show], '<hi>');
  assert.match(message.text, /https:\/\/tickets\.example\/show\?x=1&y=2/);
  assert.match(message.html, /&lt;hi&gt;/);
  assert.match(message.html, /x=1&amp;y=2/);
});

test('Resend sends one email with the full ticket link and reports provider rejection', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    assert.equal(String(input), 'https://api.resend.com/emails');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(payload.from, 'Shows <alerts@example.com>');
    assert.deepEqual(payload.to, ['me@example.com']);
    assert.match(String(payload.text), /https:\/\/tickets\.example\/show\?x=1&y=2/);
    assert.match(String(payload.html), /href="https:\/\/tickets\.example\/show\?x=1&amp;y=2"/);
    return {
      ok: calls === 1,
      status: calls === 1 ? 200 : 422,
      json: async () => ({ name: 'validation_error', message: 'Invalid from address alerts@example.com' })
    } as Response;
  }) as typeof fetch;
  try {
    const notifier = new ResendNotifier('test-key', 'Shows <alerts@example.com>');
    const message = makeMessage('me@example.com', [show]);
    await notifier.send(message);
    await assert.rejects(notifier.send(message), /Resend rejected email \(HTTP 422\): validation_error: Invalid from address \[email\]/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('email summary sends one message with both full ticket links', async () => {
  const second: Show = {
    ...show,
    id: '833aeb44-3877-4ac2-ae16-7df4f408a952',
    artist: 'Second Artist',
    ticketUrl: 'https://tickets.example/second?ref=a&seat=b'
  };
  const message = makeMessage('me@letsgetdown.io', [show, second]);
  assert.equal(message.subject, "Let's Get Down: 2 shows");
  assert.match(message.text, /https:\/\/tickets\.example\/show\?x=1&y=2/);
  assert.match(message.text, /https:\/\/tickets\.example\/second\?ref=a&seat=b/);
  assert.match(message.html, /href="https:\/\/tickets\.example\/show\?x=1&amp;y=2"/);
  assert.match(message.html, /href="https:\/\/tickets\.example\/second\?ref=a&amp;seat=b"/);
  assert.equal((message.html.match(/<li>/g) ?? []).length, 2);
  assert.equal((message.html.match(/<a href=/g) ?? []).length, 2);
  assert.doesNotMatch(message.html, /Tickets for/);

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init?.body)) as { to: string[]; html: string };
    assert.deepEqual(body.to, ['me@letsgetdown.io']);
    assert.equal(body.html, message.html);
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    await new ResendNotifier('test-key', 'Shows <alerts@example.com>').send(message);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('search uses fixed parameterized SQL, includes unknown prices without a price filter, and caps results', async () => {
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
  const first = await service.search({ start_date: day, end_date: day });
  const second = await service.search({ start_date: day, end_date: day });
  assert.equal(first.length, 20);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  const candidates: Show[] = [
    { ...show, id: '833aeb44-3877-4ac2-ae16-000000000001', startsAt: DateTime.fromISO(`${day}T18:00`, { zone: 'America/Los_Angeles' }).toUTC().toISO()!, price: null },
    { ...show, id: '833aeb44-3877-4ac2-ae16-000000000002', startsAt: DateTime.fromISO(`${day}T19:00`, { zone: 'America/Los_Angeles' }).toUTC().toISO()!, price: 29 },
    { ...show, id: '833aeb44-3877-4ac2-ae16-000000000003', startsAt: DateTime.fromISO(`${day}T20:00`, { zone: 'America/Los_Angeles' }).toUTC().toISO()!, price: 30 },
    { ...show, id: '833aeb44-3877-4ac2-ae16-000000000004', startsAt: DateTime.fromISO(`${day}T21:00`, { zone: 'America/Los_Angeles' }).toUTC().toISO()!, price: 31 }
  ];
  const key = cacheKey('search_shows', { start_date: day, end_date: day, neighborhood: undefined, genre: undefined, max_price: 30 });
  store.put(key, candidates, config.cacheTtlHours);
  try {
    const result = await service.search({ start_date: day, end_date: day, max_price: 30 });
    assert.deepEqual(result.map(item => item.price), [29, 30]);
    assert.deepEqual(result.map(item => item.id), [candidates[1]!.id, candidates[2]!.id]);
  } finally {
    store.close();
  }
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
