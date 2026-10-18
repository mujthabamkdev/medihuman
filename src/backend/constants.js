import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_DATA_FILE = resolve(process.env.DATA_FILE || join(ROOT, '.data', 'medihuman.json'));
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_LIST_ITEMS = 100;
export const COOKIE_SESSION = 'mh_session';
export const COOKIE_CSRF = 'mh_csrf';
export const PATIENT_ROLES = new Set(['patient', 'doctor']);
export const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
