import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { COOKIE_CSRF, COOKIE_SESSION, MAX_BODY_BYTES, MIME_TYPES } from './constants.js';
import { HttpError } from './errors.js';

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

export function cookieOptions({ httpOnly = false, maxAge = 8 * 60 * 60, secure }) {
  const attributes = [`Path=/`, `SameSite=${httpOnly ? 'Lax' : 'Strict'}`, `Max-Age=${maxAge}`];
  if (httpOnly) attributes.push('HttpOnly');
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function setAuthCookies(response, sessionToken, csrfToken, secure) {
  response.setHeader('Set-Cookie', [
    `${COOKIE_SESSION}=${sessionToken}; ${cookieOptions({ httpOnly: true, secure })}`,
    `${COOKIE_CSRF}=${csrfToken}; ${cookieOptions({ secure })}`,
  ]);
}

export function clearAuthCookies(response, secure) {
  response.setHeader('Set-Cookie', [
    `${COOKIE_SESSION}=; ${cookieOptions({ httpOnly: true, maxAge: 0, secure })}`,
    `${COOKIE_CSRF}=; ${cookieOptions({ maxAge: 0, secure })}`,
  ]);
}

export function sendJson(response, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...headers,
  });
  response.end(payload);
}

export function sendError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof HttpError ? error.message : 'An unexpected server error occurred.';
  sendJson(response, status, { error: { code, message } });
}

export async function readJson(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request must use application/json.');
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }
  return parsed;
}

export async function staticResponse(request, response, publicRoot, pathname, protectedDataFile, protectedDataDirectory) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'INVALID_PATH', 'Invalid path.');
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
  const filePath = normalize(join(publicRoot, relativePath));
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}/`)) throw new HttpError(403, 'FORBIDDEN', 'Forbidden.');
  if (filePath === protectedDataFile || (protectedDataDirectory !== publicRoot && filePath.startsWith(`${protectedDataDirectory}/`))) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  }
}

export function clientIp(request) {
  return request.socket?.remoteAddress || 'unknown';
}
