import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.js';
import { catalog, type CatalogServices } from '../server/catalog.js';
import { PART_SIZE, MIN_SIZE } from '../server/media.js';

// Isolated, disposable Postgres for endpoint tests. No site database or credentials are used.
export async function fixture() {
  const pg = new PGlite();
  const migration = await readFile(new URL('../netlify/database/migrations/20261103145344_create_shared_movie_catalog/migration.sql', import.meta.url), 'utf8');
  await pg.exec(migration);
  const db = drizzle({ client: pg, schema });
  const objects = new Map<string, ArrayBuffer>();
  const store = {
    async set(key: string, bytes: ArrayBuffer) { objects.set(key, bytes); },
    async get(key: string) { return objects.get(key) ?? null; },
    async delete(key: string) { objects.delete(key); },
    async list({ prefix }: { prefix: string }) { return { blobs: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
  };
  const services: CatalogServices = { database: () => db as unknown as ReturnType<CatalogServices['database']>, mediaStore: () => store as unknown as ReturnType<CatalogServices['mediaStore']>, scope: () => 'preview' };
  const call = async (path = '', method = 'GET', body?: BodyInit, headers?: Record<string, string>) => catalog(new Request('https://cineverse.test/api/catalog' + path, { method, body, headers }), services);
  const create = async () => {
    const response = await call('', 'POST', JSON.stringify({ titulo: 'Horizonte', ano: 2026, genero: 'Ficção', descricao: 'Uma viagem pelo espaço.', filename: 'filme.mp4', size: MIN_SIZE }), { 'Content-Type': 'application/json' });
    assert.equal(response.status, 201);
    return await response.json() as { id: string; parts: number; partSize: number };
  };
  return { pg, db, objects, services, call, create };
}

