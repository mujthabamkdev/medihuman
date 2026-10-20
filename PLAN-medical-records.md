# Plan: Patient Medical Records (beyond prescriptions)

## Goal
Allow patients to upload and manage **all medical records** (prescriptions, lab reports, imaging, clinical notes, documents, etc.) with date-based sorting, active/inactive medicine tracking, and full doctor visibility via approved access. Prescription reading becomes one feature among many.

## Current state
- Patient records stored as: profile, medicines (single list), prescriptions (with date), reconciliations, indications, access requests, notifications
- No generic "medical record" entity; prescription is the only document type
- Medicines are a single list with no active/inactive distinction
- No date-based filtering/sorting on the patient view
- Doctor reads patient records via `/api/doctor/patients/:id/{profile|medicines|prescriptions|reconciliations|summary}`

## Proposed data model

### 1. Medical record (new generic entity)
```js
{
  id, userId, type, title, date, description, fileRef, mimeType, sizeBytes,
  tags: [], source (self | clinic | lab), createdAt, updatedAt
}
```
- `type`: 'prescription' | 'lab_report' | 'imaging' | 'clinical_note' | 'discharge_summary' | 'vaccination' | 'other'
- `fileRef`: reference to Vercel Blob / storage (not inline bytes, due to 4.5MB limit)
- Replaces the narrow `prescription` concept; prescriptions become a `type='prescription'` medical record

### 2. Medicine (extended)
```js
{
  id, name, strength, dose, route, timing, notes,
  status: 'active' | 'discontinued' | 'completed',
  startedAt, stoppedAt, reason, prescriber
}
```
- Multiple medicines over time; active vs. discontinued tracking
- Replaces the single `medicines.items` list

### 3. Prescription (as a medical record subset)
- Keep `prescription` as a structured view of `medical_record type='prescription'`
- OR migrate: prescription becomes a medical record with type='prescription' + structured fields in `data`

## Phases

### Phase 1 — Date-based record display (frontend)
- [ ] Add `createdAt`/`updatedAt`/`date` to all record rendering
- [ ] Sort prescriptions, medicines, reconciliations by date (newest first)
- [ ] Group records by date/month in patient overview
- [ ] Show "currently taking" vs "previous" medicines (status field)

### Phase 2 — Generic medical records backend
- [ ] New table: `medical_records` (id, user_id, type, title, date, description, file_ref, mime_type, size_bytes, tags, source, created_at, updated_at, data)
- [ ] API: `GET/POST /api/patient/records`, `GET/PUT/DELETE /api/patient/records/:id`
- [ ] Validation: `recordValue`, `recordType` enum
- [ ] Storage: Vercel Blob for file uploads (private/public)
- [ ] Migration: convert existing prescriptions to medical_records type='prescription'
- [ ] Keep prescriptions endpoint as alias for backward compat

### Phase 3 — Medicine timeline
- [ ] Medicine status (active/discontinued/completed) + startedAt/stoppedAt
- [ ] UI: "Currently taking" section + "Previously taken" section
- [ ] Doctor view shows active + historical medicines with dates
- [ ] Reconciliation links to specific prescription/medicine records

### Phase 4 — Doctor visibility (approved access)
- [ ] Doctor `/api/doctor/patients/:id/records` returns all medical records (sorted by date)
- [ ] Doctor can filter by record type
- [ ] Doctor view shows timeline of all records
- [ ] Notifications: patient record updates notify approved doctors (already wired)

### Phase 5 — Upload & OCR
- [ ] File upload component (camera + file picker)
- [ ] OCR for prescriptions (existing Tesseract flow) → creates medical_record type='prescription'
- [ ] OCR for other document types (optional)
- [ ] Manual entry for non-prescription records

### Phase 6 — Summary & search
- [ ] Search/filter records by type, date range, title
- [ ] Summary endpoint includes record counts by type
- [ ] Export includes all medical records

## Database changes (Supabase)
- New table `medical_records` with RLS (service_role only)
- Add `patientName` to `publicAccessRequest` (already done)
- Migration to convert prescriptions → medical_records
- Update `medihuman_commit_normalized_state` RPC to handle `medical_records` collection
- Update `NORMALIZED_TABLES` in store.js

## Client changes
- New views: records list, record upload, record detail
- Navigation: add "Records" to patient nav (alongside Medicines)
- Date-based grouping in record list
- Medicine timeline view (active vs. historical)
- Doctor-patients view: add Records tab

## Backward compatibility
- Keep `/api/prescriptions` as alias for `type='prescription'` records
- Keep `/api/patient/medicines` working (medicine list)
- Migrate existing data on first Supabase push

## Open questions
1. File storage: Vercel Blob (private) vs. Supabase Storage? Use Vercel Blob for consistency with Vercel deployment.
2. Max file size: 4.5MB limit → use direct client uploads to Blob.
3. Should prescriptions remain a separate entity or fully merge into medical_records? Recommend: keep prescription as a structured medical record type for OCR compatibility.
4. Should medicine status be tracked per-medicine or per-prescription? Recommend: per-medicine with optional prescription link.

## Effort estimate
- Phase 1 (date display): 2-3 days
- Phase 2 (generic records backend): 5-7 days
- Phase 3 (medicine timeline): 3-4 days
- Phase 4 (doctor visibility): 2-3 days
- Phase 5 (upload & OCR): 4-5 days
- Phase 6 (summary & search): 2-3 days
- Total: ~18-25 days

## Verification
- All existing tests pass
- New tests for medical_records CRUD
- E2E: patient uploads prescription → doctor (approved) sees it in records list
- E2E: patient adds active + discontinued medicine → doctor sees timeline
- Supabase migration test: existing prescriptions convert to medical_records
