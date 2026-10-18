/**
 * Parse one medicine per line. Commas are accepted as a convenience for
 * pasted lists, while blank entries are ignored.
 */
export function parseMedicineList(value = '') {
  return String(value)
    .split(/[\r\n,]+/)
    .map((medicine) => medicine.trim())
    .filter(Boolean);
}

// Matching is exact after predictable input cleanup: case and repeated spaces
// do not change a medicine name, but strength/formulation differences do.
export function medicineKey(name) {
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

function countMedicines(medicines) {
  const counts = new Map();
  for (const name of medicines) {
    const key = medicineKey(name);
    const item = counts.get(key) || { name, count: 0 };
    item.count += 1;
    counts.set(key, item);
  }
  return counts;
}

/**
 * Reconcile prescription and dispensed lists as multisets. Duplicate entries
 * are meaningful: two prescribed entries require two dispensed entries.
 */
export function compareMedicines(prescriptionInput = '', dispensedInput = '') {
  const prescribed = parseMedicineList(prescriptionInput);
  const dispensed = parseMedicineList(dispensedInput);
  const prescribedCounts = countMedicines(prescribed);
  const dispensedCounts = countMedicines(dispensed);
  const matched = [];
  const missing = [];
  const unexpected = [];

  for (const [key, prescribedItem] of prescribedCounts) {
    const dispensedCount = dispensedCounts.get(key)?.count || 0;
    const matchedCount = Math.min(prescribedItem.count, dispensedCount);
    if (matchedCount > 0) matched.push({ name: prescribedItem.name, count: matchedCount });
    if (prescribedItem.count > dispensedCount) {
      missing.push({ name: prescribedItem.name, count: prescribedItem.count - dispensedCount });
    }
  }

  for (const [key, dispensedItem] of dispensedCounts) {
    const prescribedCount = prescribedCounts.get(key)?.count || 0;
    if (dispensedItem.count > prescribedCount) {
      unexpected.push({ name: dispensedItem.name, count: dispensedItem.count - prescribedCount });
    }
  }

  return {
    prescribed,
    dispensed,
    matched,
    missing,
    unexpected,
    isExactMatch: missing.length === 0 && unexpected.length === 0 && prescribed.length > 0,
  };
}

export function getSafetyNotes({ allergies = '', conditions = '' } = {}, comparison = null) {
  const notes = [
    'Check medicine name, strength, dose, route, and timing against the prescription before taking it.',
    'Ask a pharmacist or clinician before starting, stopping, or doubling a dose. Do not share prescription medicine.',
    'Keep this medicine list current and bring it to appointments; store medicines as labels instruct.',
    'Get urgent help for trouble breathing, facial swelling, fainting, or a severe or rapidly spreading rash.',
  ];

  if (allergies.trim()) {
    notes.unshift(`Allergies recorded: ${allergies.trim()}. Ask a pharmacist to check every dispensed medicine against them.`);
  }
  if (conditions.trim()) {
    notes.push(`Conditions recorded: ${conditions.trim()}. Confirm these are known to the prescriber and pharmacist.`);
  }
  if (comparison && (comparison.missing.length || comparison.unexpected.length)) {
    notes.unshift('Do not assume a missing or unexpected item is interchangeable; pause and clarify the discrepancy with the pharmacy or prescriber.');
  }
  return notes;
}

export const lifestyleGuidance = [
  'Use a simple daily routine or reminder to take medicines at the prescribed times.',
  'Keep water, meals, sleep, and gentle activity consistent unless your care team gave different instructions.',
  'Write down new symptoms, side effects, home readings, and questions for the next appointment.',
  'Follow the prescriber’s diet and activity guidance; this general guidance does not replace individual care.',
];
