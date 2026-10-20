import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');

// Keep this allowlist explicit: backend code and local data must never be public.
const browserAssets = [
  'index.html',
  'styles.css',
  'service-worker.js',
  'manifest.json',
  'manifest.webmanifest',
  'styles/00-tokens.css',
  'styles/01-base.css',
  'styles/02-typography.css',
  'styles/03-layout.css',
  'styles/04-components.css',
  'styles/05-views.css',
  'styles/06-roles.css',
  'styles/07-utilities.css',
  'styles/08-responsive.css',
  'src/app.js',
  'src/api-client.js',
  'src/ocr-adapter.js',
  'src/prescription-parse.js',
  'src/medication-logic.js',
  'src/clinical-logic.js',
  'src/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'src/client/state.js',
  'src/client/ui.js',
  'src/client/views.js',
  'src/client/controller.js',
  'src/client/file-upload.js',
];

// The stylesheets self-host the brand typefaces. They are optional: a build
// without the font binaries still ships, with the system stack as fallback.
const fontAssets = [
  'fonts/geist-latin.woff2',
  'fonts/geist-mono-latin.woff2',
];

export async function buildStatic(outputDirectory = resolve(projectRoot, 'public')) {
  const output = resolve(outputDirectory);
  const sources = browserAssets.map((asset) => resolve(projectRoot, asset));
  const outputPrefix = output.endsWith(sep) ? output : `${output}${sep}`;
  if ([...sources, scriptPath].some((source) => source === output || source.startsWith(outputPrefix))) {
    throw new Error('Static output must not contain source files.');
  }

  // Remove stale output so a previous build cannot leave extra files exposed.
  await rm(output, { recursive: true, force: true });
  for (const [index, asset] of browserAssets.entries()) {
    const destination = resolve(output, asset);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(sources[index], destination);
  }
  for (const asset of fontAssets) {
    const source = resolve(projectRoot, asset);
    try {
      await stat(source);
    } catch {
      process.stdout.write(`skipped missing font asset ${asset}\n`);
      continue;
    }
    const destination = resolve(output, asset);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  // Stamp the service worker with a hash of the shipped shell. A new hash
  // installs a new worker, so browsers re-cache the current assets and drop
  // the previous release instead of serving a stale shell.
  const digest = createHash('sha256');
  for (const asset of browserAssets) {
    digest.update(await readFile(resolve(projectRoot, asset)));
  }
  const shellHash = digest.digest('hex').slice(0, 12);
  const workerPath = resolve(output, 'service-worker.js');
  const worker = (await readFile(workerPath, 'utf8')).replace('__SHELL_HASH__', shellHash);
  await writeFile(workerPath, worker, 'utf8');
  process.stdout.write(`service worker shell hash ${shellHash}\n`);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await buildStatic();
}
