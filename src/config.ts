import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
loadDotEnv({ path: resolve(projectRoot, '.env'), quiet: true });

export interface Config {
  databaseUrl: string;
  databaseSslNoVerify: boolean;
  geminiApiKey?: string;
  geminiModel: string;
  resendApiKey?: string;
  emailFrom?: string;
  notifyBackends: string[];
  cacheTtlHours: number;
  cacheDbPath: string;
  mcpHost: string;
  mcpPort: number;
  mcpAuthToken?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cacheTtlHours = Number(env.CACHE_TTL_HOURS ?? 12);
  const mcpPort = Number(env.MCP_PORT ?? 3000);
  if (!Number.isFinite(cacheTtlHours) || cacheTtlHours <= 0) throw new Error('CACHE_TTL_HOURS must be positive');
  if (!Number.isInteger(mcpPort) || mcpPort < 1 || mcpPort > 65535) throw new Error('MCP_PORT is invalid');
  const notifyBackends = (env.NOTIFY_BACKENDS ?? 'resend').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (env.DATABASE_SSL_NO_VERIFY && !['true', 'false'].includes(env.DATABASE_SSL_NO_VERIFY)) {
    throw new Error('DATABASE_SSL_NO_VERIFY must be true or false');
  }
  for (const backend of notifyBackends) {
    if (!['console', 'resend'].includes(backend)) throw new Error(`Unsupported NOTIFY_BACKENDS value: ${backend}`);
  }
  return {
    databaseUrl: env.DATABASE_URL ?? '',
    databaseSslNoVerify: env.DATABASE_SSL_NO_VERIFY === 'true',
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    resendApiKey: env.RESEND_API_KEY || undefined,
    emailFrom: env.EMAIL_FROM || undefined,
    notifyBackends,
    cacheTtlHours,
    cacheDbPath: resolve(projectRoot, env.CACHE_DB_PATH || '.data/letsgetdown.sqlite'),
    mcpHost: env.MCP_HOST || '127.0.0.1',
    mcpPort,
    mcpAuthToken: env.MCP_AUTH_TOKEN || undefined
  };
}
