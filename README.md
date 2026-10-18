# MediHuman

MediHuman is a mobile-first progressive web app for organizing prescription capture, patient context, current medicines, reconciliation, clinician questions, and daily support. It is designed to make care conversations clearer; it does not diagnose, prescribe, or replace a pharmacist or clinician.

## Stack

- Plain HTML, CSS, and browser JavaScript
- Node.js 22 built-in HTTP server/API with secure-by-default JSON persistence
- PWA manifest and service worker
- Browser camera capture and best-effort Tesseract.js OCR with mandatory human review
- Node's built-in test runner for medication comparison, safety rules, and API security

## Requirements

- Node.js 22 (see `.nvmrc`)

## Setup and run

```sh
npm test
npm start
```

Open <http://localhost:4173>. Set `PORT` to use another port:

```sh
PORT=8080 npm start
```

Copy `.env.example` for the optional port reference. The server does not read `.env` automatically; export `PORT` in your shell or use a compatible environment loader.

## Docker

```sh
docker build -t medihuman .
docker run --rm -p 4173:4173 medihuman
```

Then open <http://localhost:4173>.

## Vercel deployment

Use Vercel's **Other** framework preset for a static frontend plus separate `api/` functions. The checked-in `vercel.json` sets `framework: null`, `buildCommand: "npm run build"`, and `outputDirectory: "public"`; it also prevents stale service-worker caching. Do not select a Node/server framework or rewrite all requests to a function: Vercel's automatic `server.js` backend detection can make `/api/health` work while `/`, `/index.html`, and `/styles.css` return JSON 404 responses.

In the Vercel dashboard, set **Project Settings → Build and Deployment** as follows before redeploying:

- **Framework Preset:** Other.
- **Root Directory:** the directory containing this `package.json` and `vercel.json` (`medihuman` when importing the parent repository; leave empty when this directory is the repository root).
- **Build Command:** `npm run build`.
- **Output Directory:** `public`.
- **Install Command:** leave the default; this project has no dependencies.
- **Node.js Version:** 22.x.

Remove conflicting dashboard overrides or align them with these values. `npm start` remains the local/Docker server command, not the Vercel build command.

`npm run build` recreates `public/` from an explicit browser-asset allowlist in `scripts/build-static.js`: HTML, stylesheets, service worker, both manifests, browser entrypoint/API client/OCR/domain modules, client modules, and icon. Add new browser assets to that allowlist when needed. Backend code, `server.js`, `.data`, environment files, and secrets are never copied. Generated `public/` is ignored by Git and Vercel uploads and rebuilt during deployment. The build module exports `buildStatic(outputDirectory)` for isolated checks; importing it does not run a build.

Vercel serves these files directly from its CDN and deploys the existing `api/index.js` and `api/[...path].js` adapters separately, using the shared serverless handler. After deployment, check `/`, `/index.html`, `/styles.css`, and `/api/health`; the first three should return HTML/CSS, and health should return JSON. If runtime logs report `No exports found in module "/var/task/server.mjs"`, confirm `server.js` includes its default handler export and recheck the Other preset. `/var/task` is Vercel's runtime filesystem, not a local project folder.

```sh
npm install --global vercel
vercel login
vercel
vercel --prod
```

Set production environment variables in Vercel Project Settings or with `vercel env add`:

- `NODE_ENV=production`
- `MEDIHUMAN_SUMMARY_URL` (optional)
- `MEDIHUMAN_SUMMARY_API_KEY` (optional, server-side only)
- `MEDIHUMAN_SUMMARY_MODEL` (optional)

Vercel functions use `/tmp/medihuman.json` by default. Vercel `/tmp` storage is ephemeral and instance-local: accounts, sessions, and patient records may disappear on cold starts or redeployments and may differ between function instances. This deployment setup is suitable for preview/demo use, not durable patient accounts. Production deployment needs a persistent database adapter for `src/backend/store.js`, plus secret management, audit logging, backups, and privacy/legal review.

## Architecture

MediHuman uses small, dependency-free modules with one direction of ownership:

```text
index.html
└─ src/app.js                  composition entrypoint
   ├─ src/client/state.js      state shape and browser persistence
   ├─ src/client/ui.js         HTML primitives and SVG icons
   ├─ src/client/views.js      pure view rendering
   └─ src/client/controller.js events, API calls, camera/OCR lifecycle

src/backend/api.js              HTTP composition and route order
├─ auth.js                      sessions, CSRF, roles, public users
├─ http.js                      parsing, responses, static files
├─ validation.js                request validation
├─ records.js                   record queries and serializers
└─ routes/                      system, auth, patient, access, doctor

styles.css                      stable stylesheet entrypoint
└─ styles/*.css                 ordered tokens, base, layout, components, views, roles, utilities, responsive
```

Keep these boundaries strict: views render; controllers coordinate effects; state owns browser persistence; route modules own HTTP behavior; domain modules own medication rules. Preserve `data-action`, `data-form`, API contracts, and `medihuman.local-workspace.v3` when changing internals.

## Behavior

- Lists accept one medicine per line; commas are also accepted.
- Matching is exact after trimming, collapsing repeated spaces, and ignoring letter case. Strength and formulation differences remain different medicines.
- Duplicate entries are counted, so a repeated prescription item can be identified as partially missing.
- Profile and medicine data save automatically in this browser's local storage. Use **Clear local data** to remove it.
- Backend API stores account, patient, medicine, prescription, and reconciliation records in `DATA_FILE` (default `.data/medihuman.json`, outside the static asset URL space). State-changing API requests require the CSRF token from `GET /api/csrf`.
- Auth uses scrypt password hashes and short-lived HttpOnly SameSite session cookies. Production mode (`NODE_ENV=production`) adds the Secure cookie attribute.
- Camera images stay in the browser capture flow; OCR is best-effort and every result opens an editable review step.
- The composition screen uses a small, transparent reference/rule set for common medicines and profile context. Unknown medicines, supplements, interactions, dose decisions, and handwriting remain clinician/pharmacist review items.
- Patient and doctor accounts use separate roles. Doctors request access by opaque patient ID; patients approve, reject, or revoke access before profile, medicine, prescription, or reconciliation records are visible.
- Record summaries default to transparent rule-based findings. An approved OpenAI-compatible provider can be enabled server-side with `MEDIHUMAN_SUMMARY_URL`, `MEDIHUMAN_SUMMARY_API_KEY`, and `MEDIHUMAN_SUMMARY_MODEL`; keys never reach the browser. Provider output remains an AI-assisted draft requiring clinician verification and falls back to rule-based output on timeout or provider failure.
- Safety and lifestyle content is general information, not a diagnosis or a replacement for clinician or pharmacist advice.

## API surface

- `GET /api/csrf`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`
- `GET /api/patient/access-requests`, `POST /api/patient/access-requests/:id/approve`, `POST /api/patient/access-requests/:id/revoke`, `PUT /api/patient/access-requests/:id`
- `GET|POST /api/doctor/access-requests`, `POST /api/doctor/access-requests/:patientId`
- `GET /api/doctor/patients/:patientId[/profile|/medicines|/prescriptions|/reconciliations|/summary]`
- `GET /api/patient/summary` and `GET /api/summary`
- `GET|PUT /api/patient/profile`
- `GET|PUT /api/patient/medicines`
- `GET|POST /api/prescriptions`, `GET|PUT|DELETE /api/prescriptions/:id`
- `GET|POST /api/reconciliations`, `GET /api/reconciliations/:id`

Send JSON with `Content-Type: application/json`. Send `X-CSRF-Token` matching the `mh_csrf` cookie for every state-changing request.

## Checks

`npm test` covers comparison logic, the limited composition/risk rules, API authentication, password storage, cookie/CSRF enforcement, validation errors, patient data, prescriptions, and reconciliation persistence. Before production deployment, add HTTPS termination, secret management, email verification, password reset, MFA, distributed rate limiting, durable database migrations/backups, audit logging, monitoring, privacy/legal review, and an authoritative clinical interaction data source.
