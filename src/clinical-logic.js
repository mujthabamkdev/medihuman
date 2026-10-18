const MEDICATIONS = {
  aspirin: { ingredient: 'aspirin', className: 'antiplatelet / salicylate', aliases: ['acetylsalicylic acid'] },
  atorvastatin: { ingredient: 'atorvastatin', className: 'statin' },
  ibuprofen: { ingredient: 'ibuprofen', className: 'NSAID' },
  insulin: { ingredient: 'insulin', className: 'glucose-lowering medicine' },
  levothyroxine: { ingredient: 'levothyroxine', className: 'thyroid hormone' },
  lisinopril: { ingredient: 'lisinopril', className: 'ACE inhibitor' },
  metformin: { ingredient: 'metformin', className: 'glucose-lowering medicine' },
  naproxen: { ingredient: 'naproxen', className: 'NSAID' },
  warfarin: { ingredient: 'warfarin', className: 'anticoagulant' },
};

const INTERACTIONS = [
  {
    pair: ['warfarin', 'aspirin'],
    severity: 'high',
    title: 'Bleeding risk needs clinician review',
    detail: 'Warfarin and aspirin can both affect bleeding. Do not change either medicine without a prescriber or pharmacist.',
  },
  {
    pair: ['warfarin', 'ibuprofen'],
    severity: 'high',
    title: 'Bleeding risk needs clinician review',
    detail: 'Warfarin with ibuprofen can increase bleeding risk. Ask a pharmacist before using this combination.',
  },
  {
    pair: ['warfarin', 'naproxen'],
    severity: 'high',
    title: 'Bleeding risk needs clinician review',
    detail: 'Warfarin with naproxen can increase bleeding risk. Ask a pharmacist before using this combination.',
  },
  {
    pair: ['lisinopril', 'ibuprofen'],
    severity: 'medium',
    title: 'Kidney and blood-pressure review',
    detail: 'ACE inhibitors and NSAIDs may affect kidney function and blood pressure together. Ask which pain relief is appropriate for you.',
  },
  {
    pair: ['lisinopril', 'naproxen'],
    severity: 'medium',
    title: 'Kidney and blood-pressure review',
    detail: 'ACE inhibitors and NSAIDs may affect kidney function and blood pressure together. Ask which pain relief is appropriate for you.',
  },
];

function normalize(value = '') {
  return String(value).toLowerCase().replace(/[®™]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function findMedication(name = '') {
  const normalized = normalize(name);
  return Object.entries(MEDICATIONS).find(([key, medication]) =>
    normalized === key || normalized.includes(` ${key} `) || normalized.startsWith(`${key} `) || medication.aliases?.some((alias) => normalized.includes(alias)),
  )?.[1] || null;
}

function uniqueMedicationKeys(medicines = []) {
  return [...new Set(medicines.map((medicine) => normalize(medicine.name)).filter(Boolean))];
}

function hasAny(text, words) {
  const normalized = normalize(text);
  return words.some((word) => normalized.includes(normalize(word)));
}

export function analyzeMedicationSafety(medicines = [], profile = {}) {
  const findings = [];
  const normalizedNames = uniqueMedicationKeys(medicines);
  const known = normalizedNames.map((name) => ({ name, medication: findMedication(name) }));

  for (const item of known.filter((entry) => !entry.medication)) {
    findings.push({ severity: 'info', title: 'Composition not verified', detail: `${item.name} is not in MediHuman's limited reference list. Confirm active ingredients and strength with a pharmacist.` });
  }

  for (const [key, medication] of Object.entries(MEDICATIONS)) {
    const occurrences = known.filter((entry) => findMedication(entry.name)?.ingredient === medication.ingredient).length;
    if (occurrences > 1) findings.push({ severity: 'medium', title: 'Duplicate active ingredient', detail: `${medication.ingredient} appears more than once. Confirm whether duplicate products or strengths are intentional.` });
  }

  for (const interaction of INTERACTIONS) {
    if (interaction.pair.every((ingredient) => known.some((entry) => findMedication(entry.name)?.ingredient === ingredient))) findings.push({ ...interaction });
  }

  if (hasAny(profile.allergies, ['aspirin', 'acetylsalicylic acid']) && known.some((entry) => findMedication(entry.name)?.ingredient === 'aspirin')) {
    findings.push({ severity: 'high', title: 'Recorded allergy may match aspirin', detail: 'Pause and confirm the allergy and the medicine with a clinician or pharmacist before taking it.' });
  }
  if (hasAny(profile.allergies, ['ibuprofen']) && known.some((entry) => findMedication(entry.name)?.ingredient === 'ibuprofen')) {
    findings.push({ severity: 'high', title: 'Recorded allergy may match ibuprofen', detail: 'Pause and confirm the allergy and the medicine with a clinician or pharmacist before taking it.' });
  }
  if (hasAny(profile.conditions, ['kidney disease', 'kidney problem', 'renal']) && known.some((entry) => ['ibuprofen', 'naproxen', 'metformin'].includes(findMedication(entry.name)?.ingredient))) {
    findings.push({ severity: 'medium', title: 'Kidney history needs review', detail: 'A kidney condition and some medicines may require dose or monitoring decisions. Ask your prescriber or pharmacist.' });
  }
  if (hasAny(profile.conditions, ['pregnant', 'pregnancy']) && known.some((entry) => ['lisinopril', 'warfarin'].includes(findMedication(entry.name)?.ingredient))) {
    findings.push({ severity: 'high', title: 'Pregnancy-related review needed', detail: 'Tell your prescriber promptly about pregnancy or possible pregnancy. Do not stop a medicine without medical advice.' });
  }

  return findings.length ? findings : [{ severity: 'info', title: 'No rule matched in this limited check', detail: 'This is not proof of safety. A pharmacist or clinician should review the complete medicine, supplement, allergy, and diagnosis history.' }];
}

export function medicationCompositionSummary(medicines = []) {
  return medicines.map((medicine) => {
    const known = findMedication(medicine.name);
    return { ...medicine, ingredient: known?.ingredient || 'Not verified', className: known?.className || 'Unknown' };
  });
}
