function prescriptionDate(createdAt) {
  const date = typeof createdAt === 'string' ? createdAt.match(/^\d{4}-\d{2}-\d{2}(?=T|$)/)?.[0] : '';
  if (!date) return '';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}

/** Convert a legacy prescription without inventing dates or discarding extra fields. */
export function prescriptionToRecord(prescription) {
  const { id, userId, createdAt, updatedAt, ...data } = structuredClone(prescription);
  return {
    id,
    userId,
    type: 'prescription',
    title: data.medicationName || '',
    date: prescriptionDate(createdAt),
    description: data.instructions || '',
    tags: [],
    source: 'self',
    fileRef: '',
    mimeType: '',
    sizeBytes: 0,
    createdAt,
    updatedAt,
    data,
  };
}

/** Flatten structured prescription data, keeping canonical record identity and timestamps. */
export function recordToPrescription(record) {
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? structuredClone(record.data) : {};
  return {
    ...data,
    medicationName: data.medicationName || record.title || '',
    instructions: data.instructions || record.description || '',
    id: record.id,
    userId: record.userId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Mutate both collections; existing canonical IDs always win, regardless of record type. */
export function migratePrescriptionRecords(state) {
  state.medicalRecords ??= [];
  state.prescriptions ??= [];
  if (!Array.isArray(state.medicalRecords) || !Array.isArray(state.prescriptions)) {
    throw new Error('Medical record collections must be arrays.');
  }
  const ids = new Set(state.medicalRecords.map((record) => record.id));
  for (const prescription of state.prescriptions) {
    if (ids.has(prescription.id)) continue;
    state.medicalRecords.push(prescriptionToRecord(prescription));
    ids.add(prescription.id);
  }
  state.prescriptions = state.medicalRecords
    .filter((record) => record.type === 'prescription')
    .map(recordToPrescription);
  return state;
}
