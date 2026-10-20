import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { migratePrescriptionRecords } from './medical-records.js';

const CURRENT_VERSION = 2;
const EMPTY_STATE = {
  version: CURRENT_VERSION,
  users: [],
  sessions: [],
  oauthStates: [],
  profiles: [],
  medicines: [],
  prescriptions: [],
  medicalRecords: [],
  reconciliations: [],
  indications: [],
  notifications: [],
  accessRequests: [],
  auditLogs: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeState(value) {
  if (!value || typeof value !== 'object' || ![1, CURRENT_VERSION].includes(value.version)) {
    throw new Error('Unsupported data store format');
  }
  const state = { ...clone(EMPTY_STATE), ...clone(value), version: CURRENT_VERSION };
  for (const collection of Object.keys(EMPTY_STATE).filter((key) => key !== 'version')) {
    if (value[collection] !== undefined && !Array.isArray(value[collection])) {
      throw new Error(`Invalid data store collection: ${collection}`);
    }
    if (!Array.isArray(state[collection])) state[collection] = [];
  }
  state.users = state.users.map((user) => {
    const role = user.role === 'doctor' ? 'doctor' : 'patient';
    const normalized = { ...user, role };
    if (role === 'patient') {
      normalized.patientId = typeof user.patientId === 'string' && user.patientId ? user.patientId : randomUUID();
      delete normalized.doctorProfile;
    } else {
      const doctor = user.doctorProfile && typeof user.doctorProfile === 'object' ? user.doctorProfile : {
        displayName: user.displayName,
        specialty: user.specialty,
        registrationId: user.registrationId,
        organization: user.organization,
      };
      const verificationStatus = ['pending', 'verified', 'rejected'].includes(doctor.verificationStatus)
        ? doctor.verificationStatus
        : 'pending';
      normalized.doctorProfile = {
        displayName: typeof doctor.displayName === 'string' ? doctor.displayName : '',
        specialty: typeof doctor.specialty === 'string' ? doctor.specialty : '',
        registrationId: typeof doctor.registrationId === 'string' ? doctor.registrationId : '',
        organization: typeof doctor.organization === 'string' ? doctor.organization : '',
        verificationStatus,
        verified: verificationStatus === 'verified' && doctor.verified === true,
        ...(typeof doctor.verifiedAt === 'string' ? { verifiedAt: doctor.verifiedAt } : {}),
        ...(typeof doctor.updatedAt === 'string' ? { updatedAt: doctor.updatedAt } : {}),
      };
      delete normalized.patientId;
    }
    return normalized;
  });
  return migratePrescriptionRecords(state);
}

const SUPABASE_RPC = 'medihuman_commit_normalized_state';
const NORMALIZED_TABLES = [
  {
    key: 'users',
    table: 'users',
    fields: {
      id: 'id', email: 'email', role: 'role', patient_id: 'patientId', password_hash: 'passwordHash',
      supabase_user_id: 'supabaseUserId', google_sub: 'googleSub', doctor_profile: 'doctorProfile',
      email_confirmed_at: 'emailConfirmedAt', created_at: 'createdAt', updated_at: 'updatedAt',
    },
  },
  {
    key: 'profiles',
    table: 'profiles',
    fields: {
      user_id: 'userId', full_name: 'fullName', date_of_birth: 'dateOfBirth', allergies: 'allergies',
      conditions: 'conditions', consent: 'consent', updated_at: 'updatedAt',
    },
  },
  {
    key: 'medicines',
    table: 'medicines',
    fields: { user_id: 'userId', items: 'items', updated_at: 'updatedAt' },
  },
  {
    key: 'prescriptions',
    table: 'prescriptions',
    fields: {
      id: 'id', user_id: 'userId', medication_name: 'medicationName', strength: 'strength', dose: 'dose',
      route: 'route', frequency: 'frequency', start_date: 'startDate', end_date: 'endDate',
      instructions: 'instructions', prescriber: 'prescriber', created_at: 'createdAt', updated_at: 'updatedAt',
    },
  },
  {
    key: 'medicalRecords',
    table: 'medical_records',
    fields: {
      id: 'id', user_id: 'userId', type: 'type', title: 'title', date: 'date', description: 'description',
      file_ref: 'fileRef', mime_type: 'mimeType', size_bytes: 'sizeBytes', tags: 'tags', source: 'source',
      created_at: 'createdAt', updated_at: 'updatedAt',
    },
  },
  {
    key: 'reconciliations',
    table: 'reconciliations',
    fields: {
      id: 'id', user_id: 'userId', prescription_medicines: 'prescriptionMedicines',
      dispensed_medicines: 'dispensedMedicines', matched: 'matched', missing: 'missing', unexpected: 'unexpected',
      is_exact_match: 'isExactMatch', notes: 'notes', created_at: 'createdAt', updated_at: 'updatedAt',
    },
  },
  {
    key: 'accessRequests',
    table: 'access_requests',
    fields: {
      id: 'id', doctor_user_id: 'doctorUserId', patient_user_id: 'patientUserId', status: 'status',
      requested_at: 'requestedAt', responded_at: 'respondedAt', revoked_at: 'revokedAt',
    },
  },
  {
    key: 'indications',
    table: 'indications',
    fields: {
      id: 'id', doctor_user_id: 'doctorUserId', patient_user_id: 'patientUserId', title: 'title',
      detail: 'detail', severity: 'severity', created_at: 'createdAt', updated_at: 'updatedAt',
    },
  },
  {
    key: 'notifications',
    table: 'notifications',
    fields: {
      id: 'id', recipient_user_id: 'recipientUserId', actor_user_id: 'actorUserId', type: 'type', title: 'title',
      message: 'message', entity_type: 'entityType', entity_id: 'entityId', read_at: 'readAt', created_at: 'createdAt',
    },
  },
  {
    key: 'auditLogs',
    table: 'audit_logs',
    fields: {
      id: 'id', actor_user_id: 'actorUserId', action: 'action', entity_type: 'entityType', entity_id: 'entityId',
      outcome: 'outcome', created_at: 'createdAt',
    },
  },
  {
    key: 'sessions',
    table: 'sessions',
    fields: {
      id: 'id', user_id: 'userId', token_hash: 'tokenHash', csrf_token_hash: 'csrfTokenHash', created_at: 'createdAt',
      expires_at: 'expiresAt', recovery_only: 'recoveryOnly', mfa_pending: 'mfaPending',
      mfa_pending_factor_id: 'mfaPendingFactorId', mfa_factor_id: 'mfaFactorId', mfa_challenge_id: 'mfaChallengeId',
      upstream_tokens: 'upstreamTokens',
    },
  },
  {
    key: 'oauthStates',
    table: 'oauth_states',
    fields: { state_hash: 'stateHash', role: 'role', created_at: 'createdAt', expires_at: 'expiresAt' },
  },
];

function hydrateRow(row, fields) {
  const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? clone(row.data) : {};
  for (const [column, property] of Object.entries(fields)) {
    if (row[column] !== null && row[column] !== undefined) data[property] = clone(row[column]);
  }
  return data;
}

/**
 * Supabase PostgREST store backed by normalized tables. The full JSON object
 * remains in each row's data column so route contracts survive schema changes;
 * canonical columns overlay that JSON when available. Writes are serialized
 * locally and replace the normalized snapshot through one transaction-safe RPC.
 */
export class SupabaseDataStore {
  constructor({
    url = process.env.SUPABASE_URL,
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl = globalThis.fetch,
    rpc = process.env.SUPABASE_NORMALIZED_STATE_RPC || SUPABASE_RPC,
  } = {}) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.serviceRoleKey = serviceRoleKey || '';
    this.fetchImpl = fetchImpl;
    this.rpc = rpc;
    this.state = null;
    this.writeChain = Promise.resolve();
  }

  assertConfigured() {
    if (!this.url || !this.serviceRoleKey) throw new Error('Supabase persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    if (!/^https:\/\/[^/]+$/.test(this.url)) throw new Error('SUPABASE_URL must be an HTTPS project URL.');
    if (!/^[a-z][a-z0-9_]*$/.test(this.rpc)) throw new Error('Supabase state identifiers are invalid.');
  }

  tableUrl(table, query = '') { return `${this.url}/rest/v1/${table}${query}`; }

  async request(url, options = {}) {
    this.assertConfigured();
    let response;
    try {
      response = await this.fetchImpl(url, {
        ...options,
        headers: {
          Accept: 'application/json',
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error('Supabase persistence is unavailable.');
    }
    if (!response.ok) throw new Error(`Supabase persistence request failed (${response.status}).`);
    return response;
  }

  async readRows(table) {
    const response = await this.request(this.tableUrl(table, '?select=*'));
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error(`Supabase persistence returned an invalid ${table} response.`);
    return rows;
  }

  async loadSnapshot() {
    const rowsByTable = await Promise.all(NORMALIZED_TABLES.map(async ({ key, table, fields }) => [
      key,
      (await this.readRows(table)).map((row) => hydrateRow(row, fields)),
    ]));
    const snapshot = clone(EMPTY_STATE);
    for (const [key, rows] of rowsByTable) snapshot[key] = rows;
    this.state = normalizeState(snapshot);
    return this;
  }

  async init() {
    this.assertConfigured();
    await this.loadSnapshot();
    return this;
  }

  async refresh() {
    await this.writeChain;
    await this.refreshSnapshot();
    return this;
  }

  async refreshSnapshot() {
    return this.loadSnapshot();
  }

  async commit(nextState) {
    const normalizedState = normalizeState(nextState);
    const response = await this.request(`${this.url}/rest/v1/rpc/${this.rpc}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ next_state: normalizedState }),
    });
    const result = await response.json();
    const committed = result === true || (Array.isArray(result) && result[0] === true) || result?.committed === true;
    if (!committed) throw new Error('Supabase normalized state commit failed.');
    this.state = normalizedState;
  }

  async transact(mutator) {
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      await this.refreshSnapshot();
      const workingState = clone(this.state);
      const result = await mutator(workingState);
      await this.commit(workingState);
      return result;
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }

  async read(reader) {
    await this.writeChain;
    if (!this.state) await this.loadSnapshot();
    return reader(this.state);
  }

  async importState(value, { overwrite = false } = {}) {
    const nextState = normalizeState(value);
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      await this.refreshSnapshot();
      const hasRecords = Object.entries(this.state).some(([key, collection]) => key !== 'version' && Array.isArray(collection) && collection.length > 0);
      if (hasRecords && !overwrite) throw new Error('Supabase state already contains records. Set SUPABASE_MIGRATE_OVERWRITE=1 to replace it.');
      await this.commit(nextState);
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }
}

/**
 * Dependency-free durable store. Collections and records intentionally use
 * SQLite-friendly scalar fields so this file can be migrated to node:sqlite
 * without changing the HTTP contract.
 */
export class JsonDataStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.writeChain = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.state = normalizeState(JSON.parse(raw));
      await this.persist();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = clone(EMPTY_STATE);
      await this.persist();
    }
    return this;
  }

  async persist() {
    const temporaryPath = join(dirname(this.filePath), `.${basename(this.filePath)}.${process.pid}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(this.state)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }

  async transact(mutator) {
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      const result = await mutator(this.state);
      await this.persist();
      return result;
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }

  async read(reader) {
    await this.writeChain;
    return reader(this.state);
  }
}
