import { createTestServer } from './src/backend/api.js';
import { createServer as createHttpServer } from 'node:http';

const app = await createTestServer();
const server = createHttpServer(app);
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

const jar = {};
function setCookie(header) {
  if (!header) return;
  String(header).split(',').forEach(part => {
    const m = part.match(/([^=;]+)=([^;]*)/);
    if (m) jar[m[1].trim()] = m[2].trim();
  });
}
function cookieHeader() { return Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '); }

async function request(path, { method='GET', body, csrf=true }={}) {
  const headers = {};
  if (jar.mh_session) headers['Cookie'] = cookieHeader();
  if (body) headers['Content-Type']='application/json';
  if (csrf) {
    const cr = await fetch(`${base}/api/csrf`, { headers: { 'Cookie': cookieHeader() } });
    setCookie(cr.headers.get('set-cookie'));
    const cj = await cr.json();
    headers['X-CSRF-Token'] = cj.csrfToken;
    headers['Cookie'] = cookieHeader();
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  setCookie(res.headers.get('set-cookie'));
  let json; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

// Register + login patient
const patient = await request('/api/auth/register', { method:'POST', body:{email:'debug@t.com','password':'Password12345678','role':'patient','profile':{fullName:'Debug Patient'}} });
console.log('patient registered:', patient.status);
const pid = patient.body.user.patientId;

// Save a prescription
const rx = await request('/api/prescriptions', { method:'POST', body:{medicationName:'Metformin', strength:'500 mg', frequency:'daily'} });
console.log('save prescription:', rx.status, JSON.stringify(rx.body));

// Read prescriptions as patient
const presc = await request('/api/prescriptions');
console.log('patient prescriptions:', JSON.stringify(presc.body));

// Read via doctor endpoint won't work (no access), but let's check the raw state via health
const health = await request('/api/health');
console.log('health:', JSON.stringify(health.body));

process.exit(0);
