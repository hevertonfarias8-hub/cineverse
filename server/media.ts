// Keep binary responses below the Functions payload limit, including base64 overhead.
export const PART_SIZE = 3 * 1024 * 1024;
export const MIN_SIZE = 100_000_000;
export const MAX_SIZE = 30_000_000_000;
export const MAX_COVER_SIZE = 2_000_000;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validateMovie(data: Record<string, unknown>) {
  const { titulo, ano, genero, descricao, filename, size } = data;
  if (typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 90 ||
      typeof descricao !== 'string' || !descricao.trim() || descricao.trim().length > 700 ||
      !Number.isInteger(ano) || Number(ano) < 1888 || Number(ano) > 2100 ||
      typeof genero !== 'string' || !['Ação','Ficção','Drama','Terror','Animação','Outro'].includes(genero)) {
    throw new HttpError(400, 'Preencha título, ano, gênero e descrição válidos.');
  }
  if (typeof filename !== 'string' || filename.length > 255 || !/\.(mp4|mkv)$/i.test(filename)) {
    throw new HttpError(400, 'Selecione um arquivo MP4 ou MKV.');
  }
  if (!Number.isSafeInteger(size) || Number(size) < MIN_SIZE || Number(size) > MAX_SIZE) {
    throw new HttpError(400, 'O vídeo deve ter entre 100 MB e 30 GB.');
  }
  return {
    titulo: titulo.trim(), ano: Number(ano), genero, descricao: descricao.trim(), filename,
    size: Number(size), contentType: /\.mp4$/i.test(filename) ? 'video/mp4' : 'video/x-matroska',
  };
}

export function expectedPartSize(total: number, part: number) {
  if (!Number.isInteger(part) || part < 0 || part >= Math.ceil(total / PART_SIZE)) {
    throw new HttpError(400, 'Parte de vídeo inválida.');
  }
  return Math.min(PART_SIZE, total - part * PART_SIZE);
}

// A bounded byte range lets browsers seek in a multi-GB movie without a multi-GB response.
export function byteRange(header: string | null, total: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new HttpError(416, 'Intervalo inválido.');
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new HttpError(416, 'Intervalo inválido.');
    start = Math.max(0, total - suffix); end = total - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : total - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) {
    throw new HttpError(416, 'Intervalo inválido.');
  }
  end = Math.min(end, total - 1, start + PART_SIZE - 1);
  return { start, end };
}

export function partKey(id: string, part: number, hash: string) {
  return `${id}/parts/${part}-${hash}`;
}
