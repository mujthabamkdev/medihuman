import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
assert.match(html, /data-duration="90"/);
assert.match(html, /data-width="1920"/);
assert.match(html, /data-height="1080"/);
assert.equal((html.match(/data-composition-src="compositions\/frames\//g) || []).length, 8);
assert.equal((html.match(/<audio\b/g) || []).length, 8);
assert.ok(!/<(?:script|link)[^>]+(?:src|href)="https?:/.test(html), 'remote runtime dependency');
const frames = readdirSync(resolve(root, 'compositions/frames')).filter(name => name.endsWith('.html'));
assert.equal(frames.length, 8);
for (const name of frames) {
  const frame = readFileSync(resolve(root, 'compositions/frames', name), 'utf8');
  assert.match(frame, /data-composition-id=/);
  assert.match(frame, /paused:\s*true/);
  assert.ok(!/Math\.random\(|Date\.now\(/.test(frame), `non-deterministic ${name}`);
}
for (const asset of ['assets/vendor/gsap.min.js', 'assets/fonts/inter-latin.woff2', 'compositions/captions.html']) {
  assert.ok(existsSync(resolve(root, asset)), `missing ${asset}`);
}
const meta = JSON.parse(readFileSync(resolve(root, 'audio_meta.json'), 'utf8'));
assert.equal(meta.voices.length, 8);
for (const voice of meta.voices) {
  assert.ok(existsSync(resolve(root, voice.path)));
  assert.ok(voice.duration_s > 0 && voice.words.length > 0);
  for (const word of voice.words) assert.ok(word.end >= word.start && word.start >= 0);
}
console.log('Offline video contract checks passed: 8 scenes, 8 narration clips, 90s, local assets.');
