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

## Behavior

- Lists accept one medicine per line; commas are also accepted.
- Matching is exact after trimming, collapsing repeated spaces, and ignoring letter case. Strength and formulation differences remain different medicines.
- Duplicate entries are counted, so a repeated prescription item can be identified as partially missing.
- Profile and medicine data save automatically in this browser's local storage. Use **Clear local data** to remove it.
- Backend API stores account, patient, medicine, prescription, and reconciliation records in `DATA_FILE` (default `.data/medihuman.json`, outside the static asset URL space). State-changing API requests require the CSRF token from `GET /api/csrf`.
- Auth uses scrypt password hashes and short-lived HttpOnly SameSite session cookies. Production mode (`NODE_ENV=production`) adds the Secure cookie attribute.
- Camera images stay in the browser capture flow; OCR is best-effort and every result opens an editable review step.
- The composition screen uses a small, transparent reference/rule set for common medicines and profile context. Unknown medicines, supplements, interactions, dose decisions, and handwriting remain clinician/pharmacist review items.
- Safety and lifestyle content is general information, not a diagnosis or a replacement for clinician or pharmacist advice.

## API surface

- `GET /api/csrf`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`
- `GET|PUT /api/patient/profile`
- `GET|PUT /api/patient/medicines`
- `GET|POST /api/prescriptions`, `GET|PUT|DELETE /api/prescriptions/:id`
- `GET|POST /api/reconciliations`, `GET /api/reconciliations/:id`

Send JSON with `Content-Type: application/json`. Send `X-CSRF-Token` matching the `mh_csrf` cookie for every state-changing request.

## Checks

`npm test` covers comparison logic, the limited composition/risk rules, API authentication, password storage, cookie/CSRF enforcement, validation errors, patient data, prescriptions, and reconciliation persistence. Before production deployment, add HTTPS termination, secret management, email verification, password reset, MFA, distributed rate limiting, durable database migrations/backups, audit logging, monitoring, privacy/legal review, and an authoritative clinical interaction data source.
