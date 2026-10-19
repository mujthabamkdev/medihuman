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

function normalizeState(value) {
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
      normalized.doctorProfile = {
        displayName: typeof doctor.displayName === 'string' ? doctor.displayName : '',
        specialty: typeof doctor.specialty === 'string' ? doctor.specialty : '',
        registrationId: typeof doctor.registrationId === 'string' ? doctor.registrationId : '',
        organization: typeof doctor.organization === 'string' ? doctor.organization : '',
        verificationStatus: 'pending',
        verified: false,
      };
      delete normalized.patientId;
    }
    return normalized;
  });
  return state;
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
