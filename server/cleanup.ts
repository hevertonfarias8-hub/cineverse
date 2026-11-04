import { and, eq, lt, or, inArray } from 'drizzle-orm';
import { database } from '../db/index.js';
import { movies, movieParts } from '../db/schema.js';
import { mediaStore, scope } from './storage.js';
import { partKey } from './media.js';

// Small batches also allow scheduled cleanup to recover abandoned/cancelled uploads.
export async function cleanupBatch(services = { database, mediaStore, scope }) {
  const db = services.database(), currentScope = services.scope();
  const stale = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const eligible = and(eq(movies.scope, currentScope), or(
    eq(movies.status, 'deleting'),
    and(eq(movies.status, 'uploading'), lt(movies.updatedAt, stale)),
  ));
  const [movie] = await db.select().from(movies).where(eligible).limit(1);
  if (!movie) return false;
  // Recheck after waiting for any in-flight upload transaction.
  const [claimed] = await db.update(movies).set({ status: 'deleting' }).where(and(eq(movies.id, movie.id), eligible)).returning({ id: movies.id });
  if (!claimed) return true;
  const store = services.mediaStore();
  const parts = await db.select().from(movieParts).where(eq(movieParts.movieId, movie.id)).limit(64);
  for (let offset = 0; offset < parts.length; offset += 8) {
    await Promise.all(parts.slice(offset, offset + 8).map(part => store.delete(partKey(movie.id, part.part, part.hash))));
  }
  if (parts.length) {
    await db.delete(movieParts).where(and(eq(movieParts.movieId, movie.id), inArray(movieParts.part, parts.map(part => part.part))));
  } else {
    // Includes orphaned objects if a DB write failed after a blob was uploaded.
    const { blobs } = await store.list({ prefix: `${movie.id}/` });
    for (let offset = 0; offset < blobs.length; offset += 8) {
      await Promise.all(blobs.slice(offset, offset + 8).map(blob => store.delete(blob.key)));
    }
    await db.delete(movies).where(eq(movies.id, movie.id));
  }
  return true;
}
