/**
 * Client-side file upload helpers for medical records.
 *
 * Files are validated in the browser before they are sent, then uploaded
 * directly to the API as multipart/form-data. The browser never uploads to a
 * third-party storage provider directly, so no storage credential is exposed.
 */

export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/plain',
];

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const ACCEPTED_UPLOAD_ATTRIBUTE = ALLOWED_UPLOAD_TYPES.join(',');

/** Return a user-facing reason when the file cannot be uploaded, else ''. */
export function validateFile(file) {
  if (!file) return 'Choose a file to upload.';
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Files must be 4 MB or smaller.';
  const type = String(file.type || '').toLowerCase();
  if (!ALLOWED_UPLOAD_TYPES.includes(type)) {
    return 'Only PDF, JPEG, PNG, WebP, HEIC, and plain text files are accepted.';
  }
  return '';
}

/** Read a File as a data URL so the user can preview it before uploading. */
export function readFilePreview(file) {
  return new Promise((resolve) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a record file to the API. Uses XMLHttpRequest so upload progress can
 * be reported to the user.
 */
export function uploadRecordFile({ file, fields = {}, csrf, onProgress }) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
    }
    form.append('file', file, file.name || 'record');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/patient/records/upload');
    xhr.withCredentials = true;
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.addEventListener('progress', (event) => {
      if (typeof onProgress === 'function' && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch { payload = {}; }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }
      reject(new Error(payload?.error?.message || 'The file could not be uploaded.'));
    });
    xhr.addEventListener('error', () => reject(new Error('The file could not be uploaded.')));
    xhr.send(form);
  });
}
