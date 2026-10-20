/**
 * Minimal Vercel Blob upload adapter.
 *
 * Uses the Blob REST API directly so the project keeps zero runtime
 * dependencies. When no token is configured the helper reports that storage
 * is unavailable instead of pretending the upload succeeded.
 */
import { HttpError } from './errors.js';

const UPLOAD_ENDPOINT = 'https://blob.vercel-storage.com/v1/upload';
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/plain',
]);

export function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_TOKEN || '';
}

export function storageAvailable() {
  return Boolean(blobToken());
}

export function validateUpload(file) {
  if (!file || typeof file === 'string') throw new HttpError(400, 'INVALID_FILE', 'A file upload is required.');
  const size = Number(file.size || 0);
  if (size <= 0) throw new HttpError(400, 'INVALID_FILE', 'The uploaded file is empty.');
  if (size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'Files must be 4 MB or smaller.');
  }
  const mimeType = String(file.type || '').toLowerCase();
  if (!ALLOWED_UPLOAD_TYPES.has(mimeType)) {
    throw new HttpError(400, 'INVALID_FILE', 'Only PDF, JPEG, PNG, WebP, HEIC, and plain text files are accepted.');
  }
  return { size, mimeType };
}

function safeFileName(name = 'record') {
  const cleaned = String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'record';
}

/** Upload bytes to Vercel Blob and return the public URL. */
export async function uploadToBlob({ buffer, mimeType, fileName }) {
  const token = blobToken();
  if (!token) {
    throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'File storage is not configured for this deployment.');
  }
  const response = await fetch(`${UPLOAD_ENDPOINT}/${safeFileName(fileName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-content-type': mimeType,
      'x-add-random-suffix': '1',
    },
    body: buffer,
  });
  if (!response.ok) {
    throw new HttpError(502, 'UPLOAD_FAILED', 'The file could not be stored. Try again later.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload?.url) throw new HttpError(502, 'UPLOAD_FAILED', 'The file could not be stored. Try again later.');
  return { url: payload.url, pathname: payload.pathname || '', sizeBytes: Number(payload.size || buffer.length) };
}
