import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = (source, destination) => {
  const target = resolve(root, destination);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, source), target);
};
stage('node_modules/gsap/dist/gsap.min.js', 'assets/vendor/gsap.min.js');
stage('node_modules/gsap/SECURITY.md', 'assets/vendor/GSAP-SECURITY.md');
stage('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'assets/fonts/inter-latin.woff2');
stage('node_modules/@fontsource-variable/inter/LICENSE', 'assets/fonts/OFL.txt');

// Generated source must remain usable without CDN or network access.
for (const path of ['index.html', 'compositions/captions.html']) {
  const file = resolve(root, path);
  if (!existsSync(file)) continue;
  let html = readFileSync(file, 'utf8');
  html = html.replace(/<script\b[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^\"]+"[^>]*><\/script>/g,
    '<script src="assets/vendor/gsap.min.js"></script>');
  if (path === 'index.html' && !html.includes('data-local-typography')) {
    html = html.replace('</head>', `<style data-local-typography>
      @font-face { font-family: Inter; src: url('assets/fonts/inter-latin.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: block; }
      [data-composition-id] { font-family: Inter, sans-serif !important; }
    </style></head>`);
  }
  writeFileSync(file, html);
}
console.log('Local GSAP and Inter staged; network-free composition ready.');
