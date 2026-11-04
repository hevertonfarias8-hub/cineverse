import { createHash, randomUUID } from 'node:crypto';
import { and, eq, desc, count, sql } from 'drizzle-orm';
import { database } from '../db/index.js';
import { movies, movieParts } from '../db/schema.js';
import { mediaStore, scope } from './storage.js';
import { HttpError, PART_SIZE, MAX_COVER_SIZE, validateMovie, expectedPartSize, byteRange, partKey } from './media.js';

type Movie = typeof movies.$inferSelect;

export function publicMovie(movie: Movie) {
  return {
    id: movie.id, titulo: movie.titulo, ano: movie.ano, genero: movie.genero, descricao: movie.descricao,
    capa: movie.coverType ? `/api/catalog/${movie.id}/cover` : null,
    video: `/api/catalog/${movie.id}/video`, filename: movie.filename, size: movie.size,
  };
}

async function readBody(req: Request, limit: number) {
  if (Number(req.headers.get('content-length')) > limit) throw new HttpError(413, 'Arquivo ou parte muito grande.');
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Arquivo ou parte muito grande.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export type CatalogServices = { database: typeof database; mediaStore: typeof mediaStore; scope: typeof scope };

export async function catalog(req: Request, services: CatalogServices = { database, mediaStore, scope }) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/catalog\/?/, '').split('/').filter(Boolean);
  const db = services.database();
  const currentScope = services.scope();
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Envie o filme pelo formulário deste site.');
  }
  if (!path.length) {
    if (req.method === 'GET') {
      const rows = await db.select().from(movies).where(and(eq(movies.scope, currentScope), eq(movies.status, 'published'))).orderBy(desc(movies.createdAt));
      return Response.json({ movies: rows.map(publicMovie) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (req.method === 'POST') {
      let data;
      try { data = JSON.parse(new TextDecoder().decode(await readBody(req, 16_000))); }
      catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Dados do filme inválidos.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Dados do filme inválidos.');
      const movie = validateMovie(data);
      const id = randomUUID();
      await db.insert(movies).values({ ...movie, id, scope: currentScope });
      return Response.json({ id, partSize: PART_SIZE, parts: Math.ceil(movie.size / PART_SIZE) }, { status: 201 });
    }
    throw new HttpError(405, 'Método não permitido.');
  }
  const [id, action, index] = path;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new HttpError(404, 'Filme não encontrado.');
  const condition = and(eq(movies.id, id), eq(movies.scope, currentScope));
  const [movie] = await db.select().from(movies).where(condition);
  if (!movie || movie.status === 'deleting') throw new HttpError(404, 'Filme não encontrado.');
  const store = services.mediaStore();

  if (action === 'parts' && path.length === 3 && req.method === 'PUT') {
    if (movie.status !== 'uploading') throw new HttpError(409, 'Este filme já foi publicado.');
    if (!/^\d+$/.test(index)) throw new HttpError(400, 'Parte inválida.');
    const part = Number(index), expected = expectedPartSize(movie.size, part);
    const bytes = await readBody(req, PART_SIZE);
    if (bytes.length !== expected) throw new HttpError(400, 'Parte incompleta. Tente enviá-la novamente.');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const partCondition = and(eq(movieParts.movieId, id), eq(movieParts.part, part));
    await db.transaction(async tx => {
      const [current] = await tx.select().from(movies).where(condition).for('update');
      if (!current || current.status !== 'uploading') throw new HttpError(409, 'Este envio já foi encerrado.');
      const [existing] = await tx.select().from(movieParts).where(partCondition);
      if (existing) {
        if (existing.hash !== hash) throw new HttpError(409, 'Esta parte pertence a outro arquivo. Reinicie o envio.');
        return;
      }
      await store.set(partKey(id, part, hash), bytes.buffer as ArrayBuffer);
      await tx.insert(movieParts).values({ movieId: id, part, size: bytes.length, hash });
      await tx.update(movies).set({ updatedAt: new Date() }).where(condition);
    });
    return new Response(null, { status: 204 });
  }
  if (action === 'cover' && path.length === 2 && req.method === 'PUT') {
    if (movie.status !== 'uploading') throw new HttpError(409, 'Este filme já foi publicado.');
    const type = req.headers.get('content-type')?.split(';')[0];
    if (!type || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) {
      throw new HttpError(400, 'Use capa JPG, PNG, WebP ou GIF.');
    }
    const bytes = await readBody(req, MAX_COVER_SIZE);
    if (!bytes.length) throw new HttpError(400, 'A capa está vazia.');
    await db.transaction(async tx => {
      const [current] = await tx.select().from(movies).where(condition).for('update');
      if (!current || current.status !== 'uploading') throw new HttpError(409, 'Este envio já foi encerrado.');
      await store.set(`${id}/cover`, bytes.buffer as ArrayBuffer);
      await tx.update(movies).set({ coverType: type, updatedAt: new Date() }).where(condition);
    });
    return new Response(null, { status: 204 });
  }
  if (action === 'publish' && path.length === 2 && req.method === 'POST') {
    const published = await db.transaction(async tx => {
      const [current] = await tx.select().from(movies).where(condition).for('update');
      if (!current || current.status === 'deleting') throw new HttpError(409, 'Este envio foi cancelado.');
      if (current.status === 'published') return current;
      const [received] = await tx.select({ count: count(), size: sql`coalesce(sum(${movieParts.size}), 0)`.mapWith(Number) }).from(movieParts).where(eq(movieParts.movieId, id));
      if (received.count !== Math.ceil(current.size / PART_SIZE) || received.size !== current.size) {
        throw new HttpError(409, 'O envio ainda não terminou. Envie todas as partes antes de publicar.');
      }
      const [result] = await tx.update(movies).set({ status: 'published', updatedAt: new Date() }).where(condition).returning();
      return result;
    });
    return Response.json(publicMovie(published));
  }
  if (!action && path.length === 1 && req.method === 'DELETE') {
    // Hide immediately. Cleanup removes the binary files in the background.
    await db.update(movies).set({ status: 'deleting', updatedAt: new Date() }).where(condition);
    return new Response(null, { status: 204 });
  }
  if (movie.status !== 'published') throw new HttpError(404, 'Filme ainda não publicado.');
  if (action === 'cover' && path.length === 2 && ['GET','HEAD'].includes(req.method)) {
    if (!movie.coverType) throw new HttpError(404, 'Capa não encontrada.');
    const headers = { 'Content-Type': movie.coverType, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
    if (req.method === 'HEAD') return new Response(null, { headers });
    const bytes = await store.get(`${id}/cover`, { type: 'arrayBuffer' });
    if (!bytes) throw new HttpError(503, 'Capa temporariamente indisponível.');
    return new Response(bytes, { headers });
  }
  if (action === 'video' && path.length === 2 && ['GET','HEAD'].includes(req.method)) {
    const headers = new Headers({
      'Content-Type': movie.contentType, 'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') { headers.set('Content-Length', String(movie.size)); return new Response(null, { headers }); }
    let range;
    try { range = byteRange(req.headers.get('range'), movie.size); }
    catch (error) {
      if (error instanceof HttpError && error.status === 416) {
        headers.set('Content-Range', `bytes */${movie.size}`);
        return new Response(null, { status: 416, headers });
      }
      throw error;
    }
    if (!range) {
      return Response.json({ error: 'Use o player do catálogo para assistir ao vídeo.' }, { status: 400, headers: { 'Accept-Ranges': 'bytes' } });
    }
    const first = Math.floor(range.start / PART_SIZE), last = Math.floor(range.end / PART_SIZE);
    const segments: Uint8Array[] = [];
    for (let part = first; part <= last; part++) {
      const [record] = await db.select().from(movieParts).where(and(eq(movieParts.movieId, id), eq(movieParts.part, part)));
      if (!record) throw new HttpError(503, 'Vídeo temporariamente indisponível. Tente novamente.');
      const buffer = await store.get(partKey(id, part, record.hash), { type: 'arrayBuffer' });
      if (!buffer) throw new HttpError(503, 'Parte do vídeo temporariamente indisponível. Tente novamente.');
      const start = Math.max(0, range.start - part * PART_SIZE);
      const end = Math.min(record.size, range.end - part * PART_SIZE + 1);
      segments.push(new Uint8Array(buffer).subarray(start, end));
    }
    const bytes = new Uint8Array(range.end - range.start + 1); let offset = 0;
    for (const segment of segments) { bytes.set(segment, offset); offset += segment.length; }
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${movie.size}`);
    headers.set('Content-Length', String(bytes.length));
    return new Response(bytes, { status: 206, headers });
  }
  throw new HttpError(405, 'Método não permitido.');
}
