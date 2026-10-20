import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
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
       const healthBody = await health.json();
       assert.equal(healthBody.ok, true);
       assert.equal(typeof healthBody.backend, 'string');
      const csrf = await fetch(origin + '/api/csrf');
      assert.equal(csrf.status, 200);
      assert.match(csrf.headers.get('set-cookie'), /Secure/);
      for (const path of ['/api/patient/profile', '/api/auth/login', '/api/doctor/patients/x']) {
        const response = await fetch(origin + path);
        assert.equal(response.status, 401, path);
        assert.match(response.headers.get('content-type'), /application\\/json/);
        await response.text();
      }
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
      STORE_BACKEND: 'json',
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
   assert.equal(home.headers.get('x-frame-options'), 'DENY');
   assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
   assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
   assert.match(home.headers.get('permissions-policy'), /camera/);
  assert.match(await home.text(), /<title>MediHuman/);
  const health = await fetch(origin + '/api/health');
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(typeof healthBody.backend, 'string');
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
  assert.deepEqual(config.rewrites, [
    { source: '/api/:path*', destination: '/api/index.js' },
  ]);
  assert.deepEqual(config.functions['api/index.js'], { maxDuration: 10 });
  assert.equal(config.functions['api/[...path].js'], undefined);
});

test('standalone server honors PUBLIC_ROOT and never serves backend or migration sources', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'medihuman-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = await buildStatic(join(directory, 'public'));
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const script = `
    import assert from 'node:assert/strict';
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, ['server.js'], { stdio: 'ignore' });
    const origin = 'http://127.0.0.1:' + process.env.PORT;
    const get = (path) => fetch(origin + path, { headers: { connection: 'close' } });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try { const response = await get('/api/health'); await response.text(); ready = response.ok; } catch {}
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, 'Standalone server did not start');
      for (const [path, status] of [['/',200],['/manifest.webmanifest',200],['/service-worker.js',200],['/api/patient/records',401],['/src/backend/store.js',404],['/scripts/migrate-medical-records.js',404],['/.env',404]]) {
        const response = await get(path);
        assert.equal(response.status, status, path);
        await response.text();
      }
    } finally {
      if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); }
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, VERCEL: '0', STORE_BACKEND: 'json', PUBLIC_ROOT: output, DATA_FILE: join(directory, 'private', 'data.json'), PORT: String(port) },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
