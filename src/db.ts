import type { PoolConfig } from 'pg';
import type { Config } from './config.js';

export function poolOptions(config: Config): PoolConfig {
  if (!config.databaseSslNoVerify) return { connectionString: config.databaseUrl, max: 4 };

  const url = new URL(config.databaseUrl);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    max: 4,
    ssl: { rejectUnauthorized: false }
  };
}
