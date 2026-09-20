/**
 * Serves the website the way Vercel does, so what is checked locally is what
 * ships: `cleanUrls` from vercel.json, and the same security headers.
 *
 * Static hosting is the whole deployment, so a local server that behaved
 * differently would hide exactly the mistakes worth catching before a push.
 */
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat, readFile} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT ?? 4180);

const vercel = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
/*
 * Each rule carries the paths it applies to, and applying them all to every
 * response is not "the way Vercel does it": the JSON content type meant for the
 * two .well-known files was landing on index.html, which a browser then refused
 * to render as a page.
 */
const rules = (vercel.headers ?? []).map(rule => ({
  match: new RegExp(`^${rule.source}$`),
  entries: (rule.headers ?? []).map(header => [header.key, header.value]),
}));

const headersFor = pathname =>
  Object.fromEntries(rules.filter(rule => rule.match.test(pathname)).flatMap(rule => rule.entries));

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Resolves a request path to a file inside the site, or null. */
async function resolveFile(pathname) {
  const requested = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  // A path that climbs out of the site is a traversal attempt, not a typo.
  const candidate = resolve(join(root, requested));
  if (candidate !== root && !candidate.startsWith(`${root}/`)) return null;

  const attempts = requested.endsWith('/')
    ? [join(candidate, 'index.html')]
    : [candidate, `${candidate}.html`, join(candidate, 'index.html')];

  for (const attempt of attempts) {
    const found = await stat(attempt).catch(() => null);
    if (found?.isFile()) return attempt;
  }
  return null;
}

const server = createServer(async (request, response) => {
  const {pathname} = new URL(request.url ?? '/', `http://localhost:${port}`);
  const file = await resolveFile(pathname === '/' ? '/index.html' : pathname);

  if (!file) {
    response.writeHead(404, {'content-type': 'text/plain; charset=utf-8', ...headersFor(pathname)});
    response.end(`Not found: ${pathname}\n`);
    console.log(`404 ${pathname}`);
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    ...headersFor(pathname),
  });
  createReadStream(file).pipe(response);
  console.log(`200 ${pathname}`);
});

server.listen(port, () => {
  console.log(`Rosa Pay website: http://localhost:${port}`);
});
