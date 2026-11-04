import { chromium, type BrowserContext } from 'playwright';
import { readFile, open } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { catalog } from '../server/catalog.js';
import { HttpError, MIN_SIZE } from '../server/media.js';

// Usage: npm run test:browser -- /path/to/a/small-playable-h264.mp4
// The supplied clip is padded with a valid MP4 free box to exercise the real 100 MB minimum.
const clipPath = process.argv[2];
if (!clipPath) throw new Error('Informe o caminho de um MP4 H.264 de teste, menor que 100 MB.');
const clip = await readFile(clipPath);
if (clip.length + 8 > MIN_SIZE) throw new Error('Use um clipe menor que 100 MB.');
const filePath = '/tmp/cineverse-browser-film.mp4';
const file = await open(filePath, 'w');
try {
  await file.write(clip);
  const freeBox = Buffer.alloc(8); freeBox.writeUInt32BE(MIN_SIZE - clip.length); freeBox.write('free', 4);
  await file.write(freeBox); await file.truncate(MIN_SIZE);
} finally { await file.close(); }
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const f = await fixture();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors: string[] = []; let failedOnce = false, forceFailure = false;
const partZeroRequests = new Map<string, number>();
async function setup(context: BrowserContext) {
  await context.route('https://cineverse.test/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (!url.pathname.startsWith('/api/catalog')) return route.fulfill({ status: 404 });
    if (url.pathname.endsWith('/parts/0')) partZeroRequests.set(url.pathname, (partZeroRequests.get(url.pathname) ?? 0) + 1);
    if (forceFailure && url.pathname.endsWith('/parts/5')) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Conexão de teste indisponível.' }) });
    if (url.pathname.endsWith('/parts/2') && !failedOnce) {
      failedOnce = true;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Falha transitória de teste.' }) });
    }
    try {
      const body = request.postDataBuffer();
      const req = new Request(request.url(), { method: request.method(), headers: await request.allHeaders(), ...(body ? { body: new Uint8Array(body).buffer } : {}) });
      const res = await catalog(req, f.services);
      await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      await route.fulfill({ status: error.status, contentType: 'application/json', body: JSON.stringify({ error: error.message }) });
    }
  });
}
try {
  const first = await browser.newContext(); await setup(first);
  const page = await first.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://cineverse.test/');
  await page.locator('#titulo').fill('Filme online de teste');
  await page.locator('#ano').fill('2026');
  await page.locator('#descricao').fill('Filme publicado e reproduzido por outro visitante.');
  await page.locator('#video').setInputFiles(filePath);
  await page.locator('#publicarBotao').click();
  await page.waitForFunction(() => document.getElementById('uploadMensagem')?.textContent?.includes('Filme publicado!'), null, { timeout: 90_000 });
  assert(failedOnce, 'a repetição automática de uma parte foi exercitada');
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video && video.videoWidth > 0 && video.currentTime > 0; });
  assert.equal((await page.locator('#video').inputValue()), '', 'o arquivo selecionado foi liberado do formulário');
  await page.screenshot({ path: '/tmp/cineverse-online-player.png' });
  await page.locator('.close').click();
  forceFailure = true;
  await page.locator('#titulo').fill('Envio retomado');
  await page.locator('#ano').fill('2026');
  await page.locator('#descricao').fill('Retomada de um envio interrompido.');
  await page.locator('#video').setInputFiles(filePath);
  await page.locator('#publicarBotao').click();
  await page.waitForFunction(() => document.getElementById('uploadMensagem')?.textContent?.includes('TENTAR NOVAMENTE'), null, { timeout: 60_000 });
  assert.equal((await (await f.call()).json()).movies.length, 1, 'envio interrompido não é publicado');
  const receivedZeros = new Map(partZeroRequests);
  forceFailure = false;
  await page.locator('#publicarBotao').click();
  await page.waitForFunction(() => document.getElementById('uploadMensagem')?.textContent?.includes('Filme publicado!'), null, { timeout: 90_000 });
  assert.deepEqual(partZeroRequests, receivedZeros, 'a retomada não reenvia partes já confirmadas');
  assert.equal((await (await f.call()).json()).movies.length, 2);
  await page.locator('.close').click();
  await page.locator('#titulo').fill('Envio cancelado');
  await page.locator('#ano').fill('2026');
  await page.locator('#descricao').fill('Este filme não deve ser publicado.');
  await page.locator('#video').setInputFiles(filePath);
  await page.locator('#publicarBotao').click();
  await page.waitForFunction(() => document.getElementById('uploadMensagem')?.textContent?.includes('Enviando filme'));
  await page.locator('#cancelarEnvio').click();
  await page.waitForFunction(() => document.getElementById('uploadMensagem')?.textContent?.includes('cancelado'));
  assert.equal((await (await f.call()).json()).movies.length, 2, 'cancelamento mantém o catálogo sem o envio parcial');
  const second = await browser.newContext(); await setup(second);
  const visitor = await second.newPage(); visitor.on('pageerror', error => errors.push(error.message));
  await visitor.goto('https://cineverse.test/');
  await visitor.locator('.movie').filter({ hasText: 'Filme online de teste' }).click();
  await visitor.waitForFunction(() => { const video = document.querySelector('video'); return video && video.videoWidth > 0 && video.currentTime > 0; });
  await visitor.evaluate(() => { const video = document.querySelector('video'); if (video) video.currentTime = 2; });
  await visitor.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) >= 2);
  await visitor.reload();
  await visitor.locator('.movie').filter({ hasText: 'Filme online de teste' }).waitFor();
  assert.equal(await visitor.locator('#video').inputValue(), '', 'outro visitante não precisa selecionar um arquivo');
  assert.deepEqual(errors, []);
  console.log('Navegador aprovado: envio de 100 MB, repetição após falha, retomada, cancelamento, publicação, reprodução H.264 em dois contextos independentes, busca e catálogo após recarregar.');
} finally {
  await browser.close(); await f.pg.close();
}
