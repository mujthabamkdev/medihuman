import { createApp } from './api.js';

const DATA_FILE = process.env.DATA_FILE || '/tmp/medihuman.json';
let appPromise;

function getApp() {
  appPromise ||= createApp({ dataFile: DATA_FILE });
  return appPromise;
}

export default async function vercelHandler(request, response) {
  try {
    const app = await getApp();
    await app(request, response);
  } catch (error) {
    if (response.headersSent) return;
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' } }));
  }
}
