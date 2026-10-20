/**
 * Prescription reading helpers.
 *
 * These functions describe what a text reader returned and flag the parts a
 * person must check against the original document. They never complete,
 * correct, guess, or infer a medicine name, strength, dose, route, or
 * direction. Anything uncertain is surfaced for human review.
 */

const MASS_UNITS = ['mg', 'mcg', 'ug', 'µg', 'gm', 'g', 'ml', 'iu', 'units', 'mEq', '%'];
const MICRO_UNITS = ['mcg', 'ug', 'µg'];
const DOSE_FORMS = [
  'tablet', 'tab', 'tabs', 'capsule', 'cap', 'caps', 'sachet', 'sachets', 'syrup', 'syr',
  'drop', 'drops', 'puff', 'puffs', 'patch', 'suppository', 'supp', 'injection', 'ampoule', 'vial',
  'tsp', 'tablespoon', 'tbsp', 'dose', 'doses', 'unit', 'units',
];
const ROUTES = [
  'oral', 'po', 'iv', 'im', 'sc', 'sq', 'subq', 'subcutaneous', 'topical', 'inhaled', 'inhalation',
  'rectal', 'vaginal', 'ophthalmic', 'eye', 'otic', 'ear', 'nasal', 'transdermal', 'sublingual',
];
const FREQUENCIES = {
  od: 'once daily', once: 'once daily', daily: 'once daily', qd: 'once daily', qam: 'each morning',
  bd: 'twice daily', twice: 'twice daily', bid: 'twice daily', tds: 'three times daily', tid: 'three times daily',
  tds: 'three times daily', qid: 'four times daily', hs: 'at night', nocte: 'at night', nocta: 'at night',
  mane: 'in the morning', prn: 'as needed', stat: 'immediately', qh: 'every hour',
  q2h: 'every two hours', q4h: 'every four hours', q6h: 'every six hours', q8h: 'every eight hours',
  q12h: 'every twelve hours', qpm: 'each evening', qhs: 'at bedtime',
};
const AMBIGUOUS_FREQUENCIES = ['od', 'qd', 'qid', 'qh', 'bid', 'tid', 'qam', 'qpm'];
const KNOWN_ABBREVIATIONS = new Set([
  ...Object.keys(FREQUENCIES), ...DOSE_FORMS, ...ROUTES, ...MASS_UNITS,
  'rx', 'qty', 'sig', 'tabs', 'po', 'prn', 'nrn', 'mrn', 'qty',
]);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchAll(text, pattern) {
  const found = [];
  const expression = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match = expression.exec(text);
  while (match) {
    found.push(match);
    match = expression.exec(text);
  }
  return found;
}

/** The frequency word written on a line, matched as a whole word. */
export function findFrequency(text) {
  const words = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.find((word) => Object.prototype.hasOwnProperty.call(FREQUENCIES, word)) || '';
}

/** Units written on a line, lowercased and normalised. */
export function detectUnits(text) {
  const units = new Set();
  for (const unit of MASS_UNITS) {
    const expression = new RegExp(`(^|[^a-z])${escapeRegExp(unit.toLowerCase())}([^a-z]|$)`, 'i');
    if (expression.test(String(text || ''))) units.add(unit.toLowerCase());
  }
  return [...units];
}

/**
 * Reasons a line needs a human check. Each flag explains what to verify and
 * never states what the medicine actually is.
 */
export function detectLineFlags(text) {
  const line = String(text || '');
  const flags = [];
  if (!line.trim()) return flags;
  const units = detectUnits(line);

  const micro = units.filter((unit) => MICRO_UNITS.includes(unit));
  const milli = units.filter((unit) => unit === 'mg' || unit === 'gm' || unit === 'g');
  if (micro.length && milli.length) {
    flags.push({ code: 'unit-conflict', severity: 'check', message: 'Two different mass units appear on this line. Confirm which one was written before continuing.' });
  } else if (micro.length) {
    flags.push({ code: 'unit-micro', severity: 'check', message: 'A micro unit appears on this line. Confirm the unit is micrograms and not milligrams.' });
  }

  if (/\d\.\d/.test(line)) {
    flags.push({ code: 'decimal', severity: 'check', message: 'A decimal number was read. Confirm the decimal point position, for example 0.5 against 5.' });
  }
  if (/\d\s*[-–]\s*\d/.test(line)) {
    flags.push({ code: 'range', severity: 'check', message: 'A range was read. Confirm the exact amount rather than a range.' });
  }

  const numberLetter = matchAll(line, /\b\d+[a-z]{1,3}\b/gi)
    .map((match) => match[0].toLowerCase())
    .filter((token) => !MASS_UNITS.includes(token) && !DOSE_FORMS.includes(token) && !/^(mcg|mg|ml|iu)$/.test(token));
  if (numberLetter.length) {
    flags.push({ code: 'digit-letter', severity: 'check', message: `A number and a letter were read together (${numberLetter.join(', ')}). Confirm each character, since 1/l, 0/O and 5/S are often confused in handwriting.` });
  }

  const unknown = matchAll(line, /\b[A-Z]{2,5}\b/g)
    .map((match) => match[0].toLowerCase())
    .filter((token) => !KNOWN_ABBREVIATIONS.has(token));
  if (unknown.length) {
    flags.push({ code: 'unknown-abbreviation', severity: 'check', message: `Unrecognised abbreviation (${unknown.join(', ')}). Ask the prescriber or pharmacist what it means.` });
  }

  const frequencyHit = findFrequency(line);
  if (frequencyHit && AMBIGUOUS_FREQUENCIES.includes(frequencyHit)) {
    flags.push({ code: 'frequency-letter', severity: 'check', message: 'The timing letters in this line are easy to misread. Confirm how often it should be taken.' });
  }

  const hasDoseForm = DOSE_FORMS.some((form) => new RegExp(`(^|[^a-z])${escapeRegExp(form)}([^a-z]|$)`, 'i').test(line));
  const hasMassUnit = units.length > 0;
  if (hasDoseForm && !hasMassUnit) {
    flags.push({ code: 'no-strength', severity: 'check', message: 'No strength was read on this line. Confirm the strength is written on the prescription.' });
  }
  if (hasMassUnit && !hasDoseForm) {
    flags.push({ code: 'no-dose', severity: 'info', message: 'A strength was read but no dose amount. Confirm how much to take each time.' });
  }
  return flags;
}

/** Pull the readable parts of a line without completing missing information. */
export function extractCandidate(text) {
  const line = String(text || '');
  const strength = matchAll(line, /\b\d+(?:\.\d+)?\s?(mg|mcg|ug|µg|gm|g|ml|iu|units|mEq|%)\b/gi)[0]?.[0] || '';
  const dose = matchAll(line, /\b\d+(?:\.\d+)?\s?(tablet|tab|tabs|capsule|cap|caps|sachet|sachets|syrup|drop|drops|puff|puffs|patch|suppository|supp|injection|ampoule|vial|tsp|tbsp|unit|units)\b/gi)[0]?.[0] || '';
  const route = ROUTES.find((item) => new RegExp(`(^|[^a-z])${escapeRegExp(item)}([^a-z]|$)`, 'i').test(line)) || '';
  const frequencyKey = findFrequency(line);
  const name = line
    .replace(strength, ' ')
    .replace(dose, ' ')
    .replace(/[(),;]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !ROUTES.includes(word.toLowerCase()))
    .filter((word) => !Object.keys(FREQUENCIES).includes(word.toLowerCase()))
    .slice(0, 6)
    .join(' ');
  return {
    raw: line,
    name,
    strength: strength.trim(),
    dose: dose.trim(),
    route: route ? route.toLowerCase() : '',
    frequency: frequencyKey ? FREQUENCIES[frequencyKey] : '',
  };
}

/**
 * Analyse captured text. Returns every line with its flags plus the
 * medicine-shaped lines that were read, for review only.
 */
export function analyzePrescriptionText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ index, text: line, flags: detectLineFlags(line) }));
  const flags = lines.flatMap((line) => line.flags.map((flag) => ({ ...flag, index: line.index, line: line.text })));
  const candidates = lines
    .filter((line) => /[a-z]/i.test(line.text) && !/^(note|notes|patient|date|dr|mr|mrs|pharmacy|tel|phone|fax|address|ndc|rx)/i.test(line.text))
    .map((line) => ({ ...extractCandidate(line.text), index: line.index, flags: line.flags }));
  return {
    lines,
    flags,
    candidates,
    checkCount: flags.filter((flag) => flag.severity === 'check').length,
  };
}

/** Guidance shown next to a capture so the next photo is more readable. */
export const handwritingTips = [
  'Write on plain white paper, or ask for a printed copy.',
  'Keep the page flat and avoid shadows, folds, and glare.',
  'Fill the frame, hold the phone straight, and tap to focus.',
  'Take two captures in different light and keep the clearer one.',
  'Confirm every strength, dose, and direction with a pharmacist.',
];
