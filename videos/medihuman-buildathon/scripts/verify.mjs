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
const audio = [...html.matchAll(/<audio\b([^>]*)>/g)].map(([, attributes]) =>
  Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]))
);
assert.equal(audio.length, 9);
const narration = audio.filter(clip => clip.id?.endsWith('-voice'));
assert.equal(narration.length, 8);
for (const clip of narration) assert.equal(clip['data-audio-group'], 'voiceover');
assert.equal((html.match(/\bdata-audio-group="voiceover"/g) || []).length, 8);
const beds = audio.filter(clip => clip.id === 'el-bgm');
assert.equal(beds.length, 1);
const bed = beds[0];
assert.ok(!Object.hasOwn(bed, 'data-audio-group'), 'music must stay outside the voiceover group');
assert.equal(bed['data-label'], 'Calm piano & strings');
assert.equal(bed.src, 'assets/music/calm-piano-bed.mp3');
assert.equal(bed['data-start'], '0');
assert.equal(bed['data-duration'], '90');
assert.equal(bed['data-track-index'], '11');
assert.equal(bed['data-volume'], '0.28');
const decodeAttributeJson = value => JSON.parse(value.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
const carve = decodeAttributeJson(bed['data-fx-carve']);
assert.equal(carve.enabled, true);
assert.deepEqual(carve.sources, ['voiceover'], 'carve must follow every narration clip through its group');
assert.equal(carve.strength, 0.8);
const effects = decodeAttributeJson(bed['data-fx-chain']);
assert.ok(effects.nodes.some(node => node.type === 'peaking' && node.fromCarve));
const automation = decodeAttributeJson(bed['data-automation']);
assert.ok(automation.lanes.length >= 2, 'music must carry dynamic spectral and level automation');
const effectIds = new Set(effects.nodes.map(node => node.id));
for (const lane of automation.lanes) {
  const effect = /^fx\.([^.]+)\./.exec(lane.target);
  if (effect) assert.ok(effectIds.has(effect[1]), 'automation targets a missing effect');
  assert.ok(lane.points.length > 1 && lane.points.length <= 512);
  let previous = -1;
  for (const point of lane.points) {
    assert.ok(Number.isFinite(point.t) && Number.isFinite(point.v));
    // Carve release points may extend past the clip; the 90s media slot clips them.
    assert.ok(point.t >= 0 && point.t >= previous,
      `automation out of order: ${lane.target}, t=${point.t}, previous=${previous}`);
    previous = point.t;
  }
}
assert.ok(!/<(?:script|link)[^>]+(?:src|href)="https?:/.test(html), 'remote runtime dependency');
const frames = readdirSync(resolve(root, 'compositions/frames')).filter(name => name.endsWith('.html'));
assert.equal(frames.length, 8);
for (const name of frames) {
  const frame = readFileSync(resolve(root, 'compositions/frames', name), 'utf8');
  assert.match(frame, /data-composition-id=/);
  assert.match(frame, /paused:\s*true/);
  assert.ok(!/Math\.random\(|Date\.now\(/.test(frame), `non-deterministic ${name}`);
}
for (const asset of ['assets/vendor/gsap.min.js', 'assets/fonts/inter-latin.woff2', 'compositions/captions.html', bed.src]) {
  assert.ok(existsSync(resolve(root, asset)), `missing ${asset}`);
}
const meta = JSON.parse(readFileSync(resolve(root, 'audio_meta.json'), 'utf8'));
assert.equal(meta.bgm.path, bed.src);
assert.equal(meta.bgm.duration_s, 90);
assert.equal(meta.bgm.volume, 0.28);
assert.equal(meta.bgm.provider, 'heygen.audio.sounds');
assert.equal(meta.bgm.track_id, '7c7c9903947c472e9568a88fe44bc24a');
assert.equal(meta.voices.length, 8);
for (const voice of meta.voices) {
  assert.ok(existsSync(resolve(root, voice.path)));
  assert.ok(voice.duration_s > 0 && voice.words.length > 0);
  for (const word of voice.words) assert.ok(word.end >= word.start && word.start >= 0);
}
console.log('Offline video contract checks passed: 8 scenes, 8 voiceover clips, 1 music bed, 90s, local assets.');
