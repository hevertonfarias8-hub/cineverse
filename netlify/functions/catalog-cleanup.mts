import type { Config } from '@netlify/functions';
import { cleanupBatch } from '../../server/cleanup.js';

export default async () => {
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline && await cleanupBatch()) { /* Drain pending deletions. */ }
};
export const config: Config = { background: true };
