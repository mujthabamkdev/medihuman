import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePrescriptionText,
  detectLineFlags,
  detectUnits,
  extractCandidate,
} from '../src/prescription-parse.js';
import { qualityIssues } from '../src/ocr-adapter.js';

test('reads the units written on a line', () => {
  assert.deepEqual(detectUnits('Metformin 500 mg twice daily'), ['mg']);
  assert.deepEqual(detectUnits('Levothyroxine 50 mcg each morning'), ['mcg']);
  assert.deepEqual(detectUnits('No medicine here'), []);
});

test('flags a line that mixes mass units', () => {
  const flags = detectLineFlags('Aspirin 81 mg and 100 mcg');
  assert.ok(flags.some((flag) => flag.code === 'unit-conflict'));
});

test('flags a micro dose so the unit is confirmed', () => {
  const flags = detectLineFlags('Levothyroxine 50 mcg mane');
  assert.ok(flags.some((flag) => flag.code === 'unit-micro'));
});

test('flags decimals, ranges, and unknown abbreviations', () => {
  assert.ok(detectLineFlags('Warfarin 2.5 mg daily').some((flag) => flag.code === 'decimal'));
  assert.ok(detectLineFlags('Paracetamol 500-1000 mg prn').some((flag) => flag.code === 'range'));
  assert.ok(detectLineFlags('Amoxicillin 500 mg XYZ').some((flag) => flag.code === 'unknown-abbreviation'));
});

test('flags a line with no readable strength', () => {
  const flags = detectLineFlags('Amoxicillin 1 tablet');
  assert.ok(flags.some((flag) => flag.code === 'no-strength'));
});

test('a clean printed line produces no check flags', () => {
  const flags = detectLineFlags('Metformin 500 mg twice daily with meals');
  assert.deepEqual(flags.filter((flag) => flag.severity === 'check'), []);
});

test('extracts the readable parts of a line without completing it', () => {
  const candidate = extractCandidate('Metformin 500 mg 1 tablet oral twice daily');
  assert.equal(candidate.name, 'Metformin');
  assert.equal(candidate.strength, '500 mg');
  assert.equal(candidate.dose, '1 tablet');
  assert.equal(candidate.route, 'oral');
  assert.equal(candidate.frequency, 'twice daily');
});

test('analysis reports every flagged line for review', () => {
  const analysis = analyzePrescriptionText('Amoxicillin 500 mg\nLevothyroxine 50 mcg\nWarfarin 2.5 mg daily');
  assert.equal(analysis.lines.length, 3);
  assert.ok(analysis.checkCount >= 2);
  assert.ok(analysis.flags.every((flag) => typeof flag.message === 'string' && flag.message.length > 10));
});

test('analysis of clean text reports no checks', () => {
  const analysis = analyzePrescriptionText('Metformin 500 mg\nLisinopril 10 mg daily');
  assert.equal(analysis.checkCount, 0);
});

test('capture measurements become plain guidance', () => {
  const issues = qualityIssues({ width: 640, height: 480, mean: 40, stdDev: 60, paperLevel: 120, blurVariance: 20, glareRatio: 0.3, darkRatio: 0.2 });
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes('low-resolution'));
  assert.ok(codes.includes('blurry'));
  assert.ok(codes.includes('glare'));
  assert.ok(codes.includes('too-dark'));
  assert.ok(issues.every((issue) => issue.detail.length > 20));
});

test('white paper is not reported as glare', () => {
  const issues = qualityIssues({ width: 1200, height: 900, mean: 248, stdDev: 30, paperLevel: 253, blurVariance: 400, glareRatio: 0.9, darkRatio: 0 });
  assert.deepEqual(issues.filter((issue) => issue.code === 'glare'), []);
});

test('a clean capture produces no guidance', () => {
  const issues = qualityIssues({ width: 1600, height: 1200, mean: 150, stdDev: 60, paperLevel: 230, blurVariance: 400, glareRatio: 0.01, darkRatio: 0.01 });
  assert.deepEqual(issues, []);
});
