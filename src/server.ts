import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { LocalStore } from './cache.js';
import type { Config } from './config.js';
import { createNotifiers, deliver, makeMessage } from './notify.js';
import { formatShow, formatShowWithId, ShowService } from './shows.js';

const uuid = z.uuid();
const email = z.email();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function success(text: string) { return { content: [{ type: 'text' as const, text }] }; }
function failure(error: unknown) {
  const text = error instanceof Error ? error.message : 'Unexpected error';
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export function createServer(config: Config, store: LocalStore, shows: ShowService, options: { readOnly?: boolean } = {}): McpServer {
  const server = new McpServer({ name: 'letsgetdown', version: '0.1.0' });

  server.registerTool('search_shows', {
    description: 'Find upcoming LA live shows in an inclusive LA calendar-date range. Results are capped at 20. When max_price is set, only shows with a known price at or below that amount are included.',
    inputSchema: z.object({
      start_date: date,
      end_date: date,
      neighborhood: z.string().max(80).optional(),
      genre: z.string().max(80).optional(),
      max_price: z.number().nonnegative().optional()
    })
  }, async args => {
    try {
      const result = await shows.search(args);
      return success(result.length ? result.map(formatShowWithId).join('\n') : 'No upcoming shows found.');
    } catch (error) { return failure(error); }
  });

  server.registerTool('shows_tonight', {
    description: 'List upcoming shows on the current Los Angeles calendar date (maximum 20).',
    inputSchema: z.object({ neighborhood: z.string().max(80).optional() })
  }, async ({ neighborhood }) => {
    try {
      const result = await shows.tonight(neighborhood);
      return success(result.length ? result.map(formatShowWithId).join('\n') : 'No more shows tonight.');
    } catch (error) { return failure(error); }
  });

  server.registerTool('get_show', {
    description: 'Get details for one show by UUID.',
    inputSchema: z.object({ show_id: uuid })
  }, async ({ show_id }) => {
    try {
      const show = await shows.get(show_id);
      return success(show ? `${formatShow(show)}\nShow ID: ${show.id}` : 'Show not found.');
    } catch (error) { return failure(error); }
  });

  server.registerTool('weekend_neighborhoods', {
    description: 'Rank neighborhoods by number of upcoming shows this Friday through Sunday in Los Angeles time. Counts all matching database shows, not just the first 20. Use for questions like “Which neighborhood has the most shows this weekend?”',
    inputSchema: z.strictObject({})
  }, async () => {
    try {
      const result = await shows.weekendNeighborhoods();
      const period = `${result.startDate}–${result.endDate} (LA time)`;
      if (!result.totalShows) return success(`No upcoming shows this weekend, ${period}.`);
      if (!result.neighborhoods.length) return success(`No neighborhoods could be resolved for ${result.totalShows} upcoming shows this weekend, ${period}.`);
      const clean = (name: string) => name.replace(/[\r\n\t\u0000-\u001f]+/g, ' ').trim();
      const topCount = result.neighborhoods[0]!.shows;
      const leaders = result.neighborhoods.filter(item => item.shows === topCount).map(item => clean(item.neighborhood));
      const ranking = result.neighborhoods.slice(0, 10).map(item => `${clean(item.neighborhood)}: ${item.shows} show${item.shows === 1 ? '' : 's'}`);
      const more = result.neighborhoods.length > 10 ? `\n${result.neighborhoods.length - 10} more neighborhoods omitted.` : '';
      return success(`Most upcoming shows this weekend, ${period}: ${leaders.join(' and ')} (${topCount}).\n${ranking.join('\n')}${more}\nNeighborhood unresolved: ${result.unresolvedShows} of ${result.totalShows} shows.`);
    } catch (error) { return failure(error); }
  });

  if (options.readOnly) return server;

  server.registerTool('set_my_email', {
    description: 'Register your email address on this machine before using email tools. Only one address can be registered; this does not send mail.',
    inputSchema: z.object({ email })
  }, async ({ email }) => {
    try {
      const result = store.registerEmail(email.trim().toLowerCase());
      return success(result === 'saved' ? 'Email saved for this machine.' : 'This email was already saved for this machine.');
    } catch (error) { return failure(error); }
  });

  server.registerTool('send_show_to_me', {
    description: 'Email yourself one particular upcoming show with its full ticket-purchase URL. Register an email with set_my_email first.',
    inputSchema: z.object({ show_id: uuid, note: z.string().max(500).optional() })
  }, async ({ show_id, note }) => {
    try {
      const recipient = store.getEmail();
      if (!recipient) throw new Error('No email registered on this machine. Ask the user for their email, then call set_my_email.');
      const show = await shows.getFresh(show_id);
      if (!show) throw new Error('Show not found');
      if (new Date(show.startsAt).getTime() < Date.now()) throw new Error('This show has already started');
      if (!show.ticketUrl) throw new Error('This show has no ticket URL');
      await deliver(createNotifiers(config), makeMessage(recipient, [show], note));
      return success(`Sent ${show.artist} @ ${show.venue} to the email saved on this machine.`);
    } catch (error) { return failure(error); }
  });

  server.registerTool('email_summary', {
    description: 'Email yourself a summary of 1–20 selected upcoming shows, each with a full ticket-purchase URL. Register an email first.',
    inputSchema: z.object({ show_ids: z.array(uuid).min(1).max(20) })
  }, async ({ show_ids }) => {
    try {
      const recipient = store.getEmail();
      if (!recipient) throw new Error('No email registered on this machine. Ask the user for their email, then call set_my_email.');
      if (new Set(show_ids).size !== show_ids.length) throw new Error('Duplicate show IDs are not allowed');
      const selected = await Promise.all(show_ids.map(id => shows.getFresh(id)));
      if (selected.some(show => !show)) throw new Error('One or more shows were not found');
      const valid = selected.filter(show => show !== undefined);
      if (valid.some(show => new Date(show.startsAt).getTime() < Date.now())) throw new Error('One or more shows have already started');
      if (valid.some(show => !show.ticketUrl)) throw new Error('One or more shows have no ticket URL');
      await deliver(createNotifiers(config), makeMessage(recipient, valid));
      return success(`Sent ${valid.length} shows to the email saved on this machine.`);
    } catch (error) { return failure(error); }
  });

  return server;
}
