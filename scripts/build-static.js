import { copyFile, mkdir, rm } from 'node:fs/promises';
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
  'src/medication-logic.js',
  'src/clinical-logic.js',
  'src/icon.svg',
  'src/client/state.js',
  'src/client/ui.js',
  'src/client/views.js',
  'src/client/controller.js',
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
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await buildStatic();
}
