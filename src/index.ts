import { createServer as createHttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { LocalStore } from './cache.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { ShowService } from './shows.js';

const config = loadConfig();
const store = new LocalStore(config.cacheDbPath);
const shows = new ShowService(config, store);
const factory = (readOnly = false) => () => createServer(config, store, shows, { readOnly });

function validToken(header: string | undefined): boolean {
  if (!config.mcpAuthToken) return true;
  const expected = Buffer.from(`Bearer ${config.mcpAuthToken}`);
  const received = Buffer.from(header ?? '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function main(): Promise<void> {
  const publicReadOnly = process.argv.includes('--http-public');
  if (process.argv.includes('--http') || publicReadOnly) {
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    if (!localHosts.has(config.mcpHost) && !publicReadOnly) throw new Error('Non-local HTTP binding requires --http-public; personal tools are local-only');
    if (!localHosts.has(config.mcpHost) && !config.mcpAuthToken) throw new Error('Non-local HTTP binding requires MCP_AUTH_TOKEN');
    const mcpHandler = toNodeHandler(createMcpHandler(factory(publicReadOnly)));
    const http = createHttpServer((request, response) => {
      if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
      const host = request.headers.host?.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      const origin = request.headers.origin;
      if (!host || (localHosts.has(config.mcpHost) && !localHosts.has(host)) || (!localHosts.has(config.mcpHost) && host !== config.mcpHost)) {
        response.writeHead(403).end('Forbidden host'); return;
      }
      if (origin) {
        let originHost: string;
        try { originHost = new URL(origin).hostname; } catch { response.writeHead(403).end('Forbidden origin'); return; }
        if (localHosts.has(config.mcpHost) ? !localHosts.has(originHost) : originHost !== config.mcpHost) {
          response.writeHead(403).end('Forbidden origin'); return;
        }
      }
      if (!validToken(request.headers.authorization)) { response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized'); return; }
      void mcpHandler(request, response);
    });
    http.listen(config.mcpPort, config.mcpHost, () => console.error(`letsgetdown MCP ${publicReadOnly ? 'discovery-only ' : ''}listening at http://${config.mcpHost}:${config.mcpPort}/mcp`));
  } else {
    console.error('letsgetdown MCP ready on stdio');
    await serveStdio(factory());
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
