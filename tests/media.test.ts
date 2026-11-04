import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMovie, byteRange, expectedPartSize, PART_SIZE, MIN_SIZE, MAX_SIZE, HttpError } from '../server/media.js';

const movie = { titulo: 'Horizonte', ano: 2026, genero: 'Ficção', descricao: 'Uma viagem pelo espaço.', filename: 'filme.mp4', size: MIN_SIZE };

test('aceita MP4 e MKV de 100 MB a 30 GB, incluindo os limites', () => {
  assert.equal(validateMovie(movie).contentType, 'video/mp4');
  assert.equal(validateMovie({ ...movie, filename: 'FILME.MKV', size: MAX_SIZE }).contentType, 'video/x-matroska');
  for (const patch of [{ size: MIN_SIZE - 1 }, { size: MAX_SIZE + 1 }, { size: NaN }, { size: '100000000' }, { filename: 'filme.avi' }, { filename: 'filme.mp4.exe' }, { titulo: ' ' }, { ano: 1200 }, { genero: 'inexistente' }]) {
    assert.throws(() => validateMovie({ ...movie, ...patch }), HttpError);
  }
});

test('calcula a última parte sem truncar tamanhos acima de 4 GB', () => {
  const last = Math.ceil(MAX_SIZE / PART_SIZE) - 1;
  assert.equal(expectedPartSize(MAX_SIZE, last), MAX_SIZE - last * PART_SIZE);
  assert.equal(expectedPartSize(MAX_SIZE, 0), PART_SIZE);
  for (const part of [-1, 0.5, last + 1, Infinity]) assert.throws(() => expectedPartSize(MAX_SIZE, part), HttpError);
});

test('limita leitura por intervalo e suporta busca, sufixo e fim de arquivos de 30 GB', () => {
  assert.equal(byteRange(null, MAX_SIZE), null);
  assert.deepEqual(byteRange('bytes=0-', MAX_SIZE), { start: 0, end: PART_SIZE - 1 });
  assert.deepEqual(byteRange('bytes=4294967296-4294967400', MAX_SIZE), { start: 4294967296, end: 4294967400 });
  assert.deepEqual(byteRange('bytes=-64', MAX_SIZE), { start: MAX_SIZE - 64, end: MAX_SIZE - 1 });
  assert.deepEqual(byteRange(`bytes=${MAX_SIZE - 10}-${MAX_SIZE + 10}`, MAX_SIZE), { start: MAX_SIZE - 10, end: MAX_SIZE - 1 });
  for (const range of ['bytes=30-10', `bytes=${MAX_SIZE}-`, 'bytes=-0', 'bytes=-', 'bytes=0-2,5-8', 'bytes=9007199254740992-', 'invalid']) {
    assert.throws(() => byteRange(range, MAX_SIZE), error => error instanceof HttpError && error.status === 416);
  }
});
