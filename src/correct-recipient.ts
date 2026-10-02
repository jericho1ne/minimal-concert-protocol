// One-time local repair for an accidentally registered example.com recipient.
// Never expose this operation through MCP.
import { createInterface } from 'node:readline/promises';
import * as z from 'zod/v4';
import { LocalStore } from './cache.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal');
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const input = await reader.question('Real recipient email: ');
    const email = z.email().parse(input.trim().toLowerCase());
    const confirmation = await reader.question('Replace the placeholder recipient on this machine? Type Y: ');
    if (confirmation !== 'Y') throw new Error('No change made');
    const store = new LocalStore(loadConfig().cacheDbPath);
    try {
      store.correctPlaceholderEmail(email);
    } finally {
      store.close();
    }
    console.log('Placeholder recipient replaced on this machine. No email was sent.');
  } finally {
    reader.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Recipient correction failed');
  process.exitCode = 1;
});
