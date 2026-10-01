import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export function normalizeText(value?: string): string | undefined {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() || undefined;
}

export function cacheKey(tool: string, args: Record<string, string | number | undefined>): string {
  const normalized = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([tool, normalized]);
}

export class LocalStore {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key) as { value: string; expires_at: number } | undefined;
    if (!row || row.expires_at <= Date.now()) return undefined;
    return JSON.parse(row.value) as T;
  }

  put(key: string, value: unknown, ttlHours: number): void {
    this.db.prepare('INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
      .run(key, JSON.stringify(value), Date.now() + ttlHours * 3_600_000);
  }

  getEmail(): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'email'").get() as { value: string } | undefined;
    return row?.value;
  }

  registerEmail(email: string): 'saved' | 'already-saved' {
    const existing = this.getEmail();
    if (existing) {
      if (existing !== email) throw new Error('This machine already has a different email address configured. Change it locally, outside MCP.');
      return 'already-saved';
    }
    this.db.prepare("INSERT INTO settings (key, value) VALUES ('email', ?)").run(email);
    return 'saved';
  }

  close(): void { this.db.close(); }
}
