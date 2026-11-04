import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { catalog, type CatalogServices } from '../server/catalog.js';
import { cleanupBatch } from '../server/cleanup.js';
import { PART_SIZE, MIN_SIZE, HttpError } from '../server/media.js';
import { fixture } from './fixture.js';

test('envio completo publica no catálogo compartilhado e permite busca entre partes', async () => {
  const f = await fixture();
  try {
    const upload = await f.create();
    assert.equal(upload.partSize, PART_SIZE);
    assert.deepEqual((await (await f.call()).json()).movies, []);
    await assert.rejects(f.call(`/${upload.id}/publish`, 'POST'), error => error instanceof HttpError && error.status === 409);
    await assert.rejects(f.call(`/${upload.id}/video`, 'GET', undefined, { Range: 'bytes=0-4' }), error => error instanceof HttpError && error.status === 404);
    const first = new Uint8Array(PART_SIZE).fill(1);
    assert.equal((await f.call(`/${upload.id}/parts/0`, 'PUT', first)).status, 204);
    assert.equal((await f.call(`/${upload.id}/parts/0`, 'PUT', first)).status, 204);
    assert.equal(f.objects.size, 1, 'repetição da parte não duplica o armazenamento');
    await assert.rejects(f.call(`/${upload.id}/parts/0`, 'PUT', new Uint8Array(PART_SIZE).fill(9)), error => error instanceof HttpError && error.status === 409);
    await assert.rejects(f.call(`/${upload.id}/parts/1`, 'PUT', new Uint8Array(10)), error => error instanceof HttpError && error.status === 400);
    for (let part = 1; part < upload.parts; part++) {
      const size = Math.min(PART_SIZE, MIN_SIZE - part * PART_SIZE);
      await f.call(`/${upload.id}/parts/${part}`, 'PUT', new Uint8Array(size).fill(part + 1));
    }
    await f.call(`/${upload.id}/cover`, 'PUT', new Uint8Array([137,80,78,71]), { 'Content-Type': 'image/png' });
    const published = await (await f.call(`/${upload.id}/publish`, 'POST')).json();
    assert.equal(published.video, `/api/catalog/${upload.id}/video`);
    assert.equal((await (await f.call()).json()).movies[0].id, upload.id, 'outro visitante encontra o filme sem estado do navegador');
    assert.equal((await (await f.call(`/${upload.id}/publish`, 'POST')).json()).id, upload.id, 'publicação pode ser repetida após perda de resposta');
    const response = await f.call(`/${upload.id}/video`, 'GET', undefined, { Range: `bytes=${PART_SIZE - 2}-${PART_SIZE + 2}` });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), `bytes ${PART_SIZE - 2}-${PART_SIZE + 2}/${MIN_SIZE}`);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1,1,2,2,2]);
    const tail = await f.call(`/${upload.id}/video`, 'GET', undefined, { Range: 'bytes=-8' });
    assert.equal((await tail.arrayBuffer()).byteLength, 8);
    const head = await f.call(`/${upload.id}/video`, 'HEAD');
    assert.equal(head.headers.get('Content-Length'), String(MIN_SIZE));
    const invalid = await f.call(`/${upload.id}/video`, 'GET', undefined, { Range: `bytes=${MIN_SIZE}-` });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('Content-Range'), `bytes */${MIN_SIZE}`);
    assert.equal((await f.call(`/${upload.id}/cover`)).headers.get('Content-Type'), 'image/png');
    await assert.rejects(f.call(`/${upload.id}/parts/1`, 'PUT', first), error => error instanceof HttpError && error.status === 409);
    await f.call(`/${upload.id}`, 'DELETE');
    assert.deepEqual((await (await f.call()).json()).movies, []);
    while (await cleanupBatch(f.services)) { /* Drain cleanup batches. */ }
    assert.equal(f.objects.size, 0);
    assert.equal((await f.db.select().from(schema.movies)).length, 0);
    assert.equal((await f.db.select().from(schema.movieParts)).length, 0);
  } finally { await f.pg.close(); }
});

test('cancelamento, isolamento de produção e limpeza de envios abandonados', async () => {
  const f = await fixture();
  try {
    const upload = await f.create();
    await f.call(`/${upload.id}/parts/0`, 'PUT', new Uint8Array(PART_SIZE));
    await assert.rejects(f.call('/not-a-uuid/video'), error => error instanceof HttpError && error.status === 404);
    await assert.rejects(f.call('', 'POST', '{}', { Origin: 'https://another.test' }), error => error instanceof HttpError && error.status === 403);
    await assert.rejects(f.call(`/${upload.id}/cover`, 'PUT', '<svg/>', { 'Content-Type': 'image/svg+xml' }), error => error instanceof HttpError && error.status === 400);
    const production: CatalogServices = { ...f.services, scope: () => 'production' };
    await assert.rejects(catalog(new Request(`https://cineverse.test/api/catalog/${upload.id}`, { method: 'DELETE' }), production), error => error instanceof HttpError && error.status === 404);
    await f.call(`/${upload.id}`, 'DELETE');
    while (await cleanupBatch(f.services)) { /* Drain cleanup batches. */ }
    assert.equal(f.objects.size, 0);
    const stale = await f.create();
    await f.db.update(schema.movies).set({ updatedAt: new Date(Date.now() - 49 * 3600_000) }).where(eq(schema.movies.id, stale.id));
    await cleanupBatch(f.services);
    assert.equal((await f.db.select().from(schema.movies)).length, 0);
  } finally { await f.pg.close(); }
});
