import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const CURRENT_VERSION = 2;
const EMPTY_STATE = {
  version: CURRENT_VERSION,
  users: [],
  sessions: [],
  oauthStates: [],
  profiles: [],
  medicines: [],
  prescriptions: [],
  reconciliations: [],
  indications: [],
  notifications: [],
  accessRequests: [],
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
  return state;
}

const SUPABASE_STATE_ID = 'singleton';
const SUPABASE_TABLE = 'medihuman_state';
const SUPABASE_RPC = 'medihuman_commit_state';

function isSupabaseConflict(value) {
  return value instanceof Error && value.code === 'SUPABASE_REVISION_CONFLICT';
}

/**
 * Supabase PostgREST store. One JSONB row preserves current route contracts
 * while revision checks prevent whole-state lost updates across instances.
 * Revision-only refreshes keep egress low; full state loads happen on cold
 * start or after another instance commits a change.
 */
export class SupabaseDataStore {
  constructor({
    url = process.env.SUPABASE_URL,
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl = globalThis.fetch,
    table = process.env.SUPABASE_STATE_TABLE || SUPABASE_TABLE,
    rpc = process.env.SUPABASE_STATE_RPC || SUPABASE_RPC,
    maxConflictRetries = 2,
  } = {}) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.serviceRoleKey = serviceRoleKey || '';
    this.fetchImpl = fetchImpl;
    this.table = table;
    this.rpc = rpc;
    this.maxConflictRetries = maxConflictRetries;
    this.state = null;
    this.revision = 0;
    this.writeChain = Promise.resolve();
  }

  assertConfigured() {
    if (!this.url || !this.serviceRoleKey) throw new Error('Supabase persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    if (!/^https:\/\/[^/]+$/.test(this.url)) throw new Error('SUPABASE_URL must be an HTTPS project URL.');
    if (!/^[a-z][a-z0-9_]*$/.test(this.table) || !/^[a-z][a-z0-9_]*$/.test(this.rpc)) throw new Error('Supabase state identifiers are invalid.');
  }

  tableUrl(query = '') { return `${this.url}/rest/v1/${this.table}${query}`; }

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

  async readRows(select) {
    const query = `?select=${encodeURIComponent(select)}&id=eq.${SUPABASE_STATE_ID}&limit=1`;
    const response = await this.request(this.tableUrl(query));
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Supabase persistence returned an invalid state response.');
    return rows;
  }

  async loadSnapshot() {
    let rows = await this.readRows('id,revision,state');
    if (!rows.length) {
      await this.request(this.tableUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ id: SUPABASE_STATE_ID, revision: 1, state: clone(EMPTY_STATE) }),
      });
      rows = await this.readRows('id,revision,state');
    }
    const row = rows[0];
    if (!row || !Number.isInteger(Number(row.revision))) throw new Error('Supabase persistence returned an invalid revision.');
    this.state = normalizeState(row.state);
    this.revision = Number(row.revision);
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
    if (!this.state) return this.loadSnapshot();
    const rows = await this.readRows('revision');
    if (!rows.length || Number(rows[0].revision) !== this.revision) await this.loadSnapshot();
    return this;
  }

  async commit(nextState, expectedRevision) {
    const response = await this.request(`${this.url}/rest/v1/rpc/${this.rpc}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: expectedRevision, next_state: nextState }),
    });
    const result = await response.json();
    const committed = result === true || (Array.isArray(result) && result[0] === true) || result?.committed === true;
    if (!committed) {
      const error = new Error('Supabase state revision conflict.');
      error.code = 'SUPABASE_REVISION_CONFLICT';
      throw error;
    }
    this.state = nextState;
    this.revision = expectedRevision + 1;
  }

  async transact(mutator) {
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      for (let attempt = 0; attempt <= this.maxConflictRetries; attempt += 1) {
        await this.refreshSnapshot();
        const workingState = clone(this.state);
        const result = await mutator(workingState);
        try {
          await this.commit(workingState, this.revision);
          return result;
        } catch (error) {
          if (!isSupabaseConflict(error) || attempt === this.maxConflictRetries) throw error;
        }
      }
      throw new Error('Supabase persistence failed after conflict retries.');
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
    await this.refreshSnapshot();
    const hasRecords = Object.entries(this.state).some(([key, collection]) => key !== 'version' && Array.isArray(collection) && collection.length > 0);
    if (hasRecords && !overwrite) throw new Error('Supabase state already contains records. Set SUPABASE_MIGRATE_OVERWRITE=1 to replace it.');
    await this.commit(nextState, this.revision);
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
