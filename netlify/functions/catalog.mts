import type { Config, Context } from '@netlify/functions';
import { catalog } from '../../server/catalog.js';
import { HttpError } from '../../server/media.js';

export default async (req: Request, context: Context) => {
  try {
    const response = await catalog(req);
    if (req.method === 'DELETE' && response.ok) {
      const endpoint = new URL('/.netlify/functions/catalog-cleanup', req.url);
      context.waitUntil(fetch(endpoint, { method: 'POST' }).catch(() => undefined));
    }
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof HttpError ? error.message : 'Não foi possível acessar o catálogo. Tente novamente em instantes.' }, {
      status: error instanceof HttpError ? error.status : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
};

export const config: Config = { path: ['/api/catalog', '/api/catalog/*'] };
