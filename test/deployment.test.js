import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as entrypoint from '../server.js';
import { buildStatic } from '../scripts/build-static.js';
import { createTestServer } from '../src/backend/api.js';

test('Vercel-detected server entrypoint exports a request handler', () => {
  assert.equal(typeof entrypoint.default, 'function');
});

test('deployed entrypoint serves HTML, assets, and API without binding its own port', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-deployment-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = `
    import assert from 'node:assert/strict';
    import { createServer } from 'node:http';
    import handler from './server.js';
    const server = createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    try {
      for (const path of ['/', '/styles.css', '/src/client/controller.js']) {
        const response = await fetch(origin + path);
        assert.equal(response.status, 200, path);
        await response.text();
      }
      const health = await fetch(origin + '/api/health');
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });
      const csrf = await fetch(origin + '/api/csrf');
      assert.equal(csrf.status, 200);
      assert.match(csrf.headers.get('set-cookie'), /Secure/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../', import.meta.url),
    env: {
      ...process.env,
      VERCEL: '1',
      NODE_ENV: 'production',
      DATA_FILE: join(directory, 'data.json'),
    },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('static deployment serves every offline-shell asset without exposing server files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-static-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = await buildStatic(join(directory, 'public'));
  // Rebuild must remove files left by an older output, not publish them.
  await writeFile(join(output, 'stale.txt'), 'old output');
  await buildStatic(output);
  const server = await createTestServer({
    publicRoot: output,
    dataFile: join(directory, 'private', 'data.json'),
    secureCookies: false,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const worker = await readFile(join(output, 'service-worker.js'), 'utf8');
  const shell = worker.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  const paths = [...shell.matchAll(/'([^']+)'/g)].map((match) => match[1]);

  for (const path of [...paths, '/service-worker.js']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, `Missing deployment asset: ${path}`);
    await response.arrayBuffer();
  }
  const home = await fetch(origin + '/');
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /<title>MediHuman/);
  const health = await fetch(origin + '/api/health');
  assert.deepEqual(await health.json(), { ok: true });
  for (const path of ['/src/backend/api.js', '/server.js', '/.env.example', '/.data/medihuman.json', '/stale.txt']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 404, `Private or stale file exposed: ${path}`);
    await response.text();
  }
});

test('Vercel explicitly builds static output rather than detecting a server framework', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'public');
  assert.ok(config.functions['api/[...path].js']);
});
