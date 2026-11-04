import { getDatabase } from '@netlify/database';
import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from './schema.js';

export function database() {
  return drizzle({ client: getDatabase(), schema });
}
