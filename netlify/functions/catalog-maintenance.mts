import type { Config } from '@netlify/functions';
import { cleanupBatch } from '../../server/cleanup.js';

export default async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && await cleanupBatch()) { /* Recover interrupted cleanup. */ }
};
export const config: Config = { schedule: '0 * * * *' };
