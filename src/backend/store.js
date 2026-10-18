import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const EMPTY_STATE = {
  version: 1,
  users: [],
  sessions: [],
  profiles: [],
  medicines: [],
  prescriptions: [],
  reconciliations: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) {
    throw new Error('Unsupported data store format');
  }
  for (const collection of Object.keys(EMPTY_STATE).filter((key) => key !== 'version')) {
    if (!Array.isArray(value[collection])) throw new Error(`Invalid data store collection: ${collection}`);
  }
  return { ...EMPTY_STATE, ...value };
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
