import { pgTable, uuid, text, integer, bigint, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

export const movies = pgTable('movies', {
  id: uuid().primaryKey(),
  titulo: text().notNull(),
  ano: integer().notNull(),
  genero: text().notNull(),
  descricao: text().notNull(),
  filename: text().notNull(),
  size: bigint({ mode: 'number' }).notNull(),
  contentType: text('content_type').notNull(),
  coverType: text('cover_type'),
  scope: text().notNull(),
  status: text().notNull().default('uploading'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('movies_catalog_idx').on(table.scope, table.status, table.createdAt)]);

export const movieParts = pgTable('movie_parts', {
  movieId: uuid('movie_id').notNull().references(() => movies.id, { onDelete: 'cascade' }),
  part: integer().notNull(),
  size: integer().notNull(),
  hash: text().notNull(),
}, table => [primaryKey({ columns: [table.movieId, table.part] })]);
