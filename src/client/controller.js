import { compareMedicines } from '../medication-logic.js';
import { api, ApiError, currentCsrfToken, googleAuthErrorMessage } from '../api-client.js';
import { createOcrAdapter } from '../ocr-adapter.js';
import { analyzePrescriptionText } from '../prescription-parse.js';
import {
  LOCAL_KEY,
  emptyProfile,
  ensureLocalIdentity,
  loadLocal,
  medicineObject,
  saveLocal,
  setLocalMode,
} from './state.js';
import { escapeHtml, notice } from './ui.js';
import { readFilePreview, uploadRecordFile, validateFile } from './file-upload.js';

/** Orchestrate browser events, API calls, persistence, and camera/OCR lifecycle. */
export function createController({ root, state, views, ocr = createOcrAdapter() }) {
  let previousView = null;

  /** Chart widths come from CSSOM so the strict CSP never blocks inline styles. */
  function applyChartMetrics() {
    const doc = globalThis.document;
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    doc.querySelectorAll('[data-progress-width]').forEach((element) => {
      const value = Number(element.dataset.progressWidth);
      if (Number.isFinite(value)) element.style.width = `${Math.min(Math.max(value, 0), 100)}%`;
    });
    doc.querySelectorAll('[data-bar-width]').forEach((element) => {
      const value = Number(element.dataset.barWidth);
      if (Number.isFinite(value)) element.style.setProperty('--bar', `${Math.min(Math.max(value, 0), 100)}%`);
    });
  }
  function render() {
    const focusedId = globalThis.document?.activeElement?.id;
    const viewChanged = previousView !== null && previousView !== state.view;
    previousView = state.view;
    root.innerHTML = state.screen === 'auth' ? views.renderAuth() : views.renderShell();
    applyChartMetrics();
    bindCamera();
    ensureSelectedDoctorRecord();
    if (state.localExitPrompt) {
      globalThis.document?.getElementById('local-exit-keep')?.focus();
    } else if (viewChanged && state.screen !== 'auth') {
      globalThis.document?.querySelector('#main-content h1')?.focus();
    } else if (focusedId) {
      globalThis.document?.getElementById(focusedId)?.focus();
    }
  }

  /**
   * The clinician record view always shows the patient it has selected, so a
   * missing record is fetched as soon as the view is painted.
   */
  function ensureSelectedDoctorRecord() {
    if (state.localOnly || state.role !== 'doctor' || state.view !== 'doctor-patients') return;
    const patientId = state.selectedPatientId;
    if (!patientId || state.doctorRecords[patientId]) return;
    loadDoctorPatient(patientId);
  }

  function bindCamera() {
    const video = document.querySelector('#camera-video');
    if (!video || !state.cameraStream) return;
    if (video.srcObject !== state.cameraStream) video.srcObject = state.cameraStream;
    video.play().catch(() => {
      state.cameraError = 'Camera preview could not play. Tap Try camera again or use Upload photo.';
    });
  }



  function enterLocal() { const requestedRole = state.authRoleExplicit ? state.authRole : ''; state.authError = ''; state.localOnly = true; state.googleConfigured = false; state.screen = 'shell'; loadLocal(state); state.role = requestedRole || state.role || 'patient'; state.authRole = state.role; state.authRoleExplicit = false; ensureLocalIdentity(state); setLocalMode(true); saveLocal(state); render(); }

  async function loadRoleData() {
    if (state.localOnly) return;
    try {
      if (state.role === 'patient') {
        const [access, prescriptions, reconciliations, indications, notifications, records] = await Promise.all([api.patientAccessRequests(), api.prescriptions(), api.reconciliations(), api.indications(), api.notifications(), api.records()]);
        state.patientRequests = access.requests || [];
        state.prescriptions = prescriptions.prescriptions || [];
        state.reconciliations = reconciliations.reconciliations || [];
        state.indications = indications.indications || [];
        state.notifications = notifications.notifications || [];
        state.records = records.records || [];      } else {
        const [access, notifications] = await Promise.all([api.doctorAccessRequests(), api.notifications()]);
        state.doctorRequests = access.requests || [];
        state.notifications = notifications.notifications || [];
      }
    } catch (error) {
      state.authError = error.message;
    }
  }

  async function hydrateRemote() {
    const browserWindow = globalThis.window;
    const search = browserWindow?.location?.search || '';
    const callbackError = googleAuthErrorMessage(search);
    if (callbackError) state.authError = callbackError;
    let recoveryCallback = false;
    try { recoveryCallback = new URLSearchParams(search).get('recovery') === '1'; } catch { /* malformed query cannot block normal hydration */ }
    if (browserWindow?.history?.replaceState && search) {
      try {
        const params = new URLSearchParams(search);
        if (params.has('error') || params.has('error_description') || params.has('code') || params.has('state') || params.has('access_token') || params.has('id_token')) {
          browserWindow.history.replaceState(null, '', `${browserWindow.location.pathname || '/'}${browserWindow.location.hash || ''}`);
        }
      } catch { /* malformed callback query cannot block normal session hydration */ }
    }
    if (recoveryCallback) {
      state.authMode = 'reset';
      state.screen = 'auth';
      render();
      return;
    }
    try {
      const data = await api.me();
      state.user = data.user; state.role = data.user.role || 'patient'; state.authRole = state.role; state.profile = data.profile || state.profile; state.medicines = data.medicines || [];
      state.doctorProfile = data.user.doctorProfile || data.user.doctor || state.doctorProfile;
      state.localOnly = false; state.screen = 'shell';
      try { state.googleConfigured = (await api.googleConfigured()).googleConfigured === true; } catch { state.googleConfigured = false; }
      await loadRoleData();
      await loadMfaFactors();
      render();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) state.authError = error.message;
      try { state.googleConfigured = (await api.googleConfigured()).googleConfigured === true; } catch { state.googleConfigured = false; }
      render();
    }
  }

  async function submitAuth(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (state.authMode === 'recover') {
      const result = await api.recover(data.email);
      state.authError = result.message;
      render();
      return;
    }
    const isRegister = state.authMode === 'register';
    if (isRegister && data.consent !== 'on') return showAuthError('Please acknowledge the safety and privacy statement.');
    const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
    try {
      const role = state.authRole;
      const result = isRegister ? await api.register({ email: data.email, password: data.password, role, profile: role === 'patient' ? { fullName: data.fullName || '' } : {}, ...(role === 'doctor' ? { doctor: { displayName: data.name, specialty: data.specialty, registrationId: data.registrationId, organization: data.organization } } : {}) }) : await api.login({ email: data.email, password: data.password });
      if (result.pendingEmailConfirmation) { state.authError = result.message; render(); return; }
      if (result.mfaRequired) { state.authMode = 'mfa'; state.authError = ''; render(); return; }
      if (!isRegister && result.user.role !== role) {
        try { await api.logout(); } catch { /* credentials remain untouched */ }
        throw new Error(`This account is registered as ${result.user.role}. Choose that role to sign in.`);
      }
      state.authError = ''; state.user = result.user; state.role = result.user.role || role; state.doctorProfile = result.user.doctorProfile || result.user.doctor || state.doctorProfile; state.profile = result.profile || state.profile; state.screen = 'shell'; state.localOnly = false; setLocalMode(false);
      if (state.role === 'patient') {
        try { const [profile, medicines] = await Promise.all([api.profile(), api.medicines()]); state.profile = profile.profile || state.profile; state.medicines = medicines.medicines || []; } catch { /* auth succeeded; empty workspace is valid */ }
      }
      await loadRoleData();
      await loadMfaFactors();
      render();
    } catch (error) { showAuthError(error.message); submit.disabled = false; }
  }

  async function submitPasswordReset(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (data.password !== data.confirmPassword) throw new Error('Passwords do not match.');
    const result = await api.updatePassword(data.password);
    state.authMode = 'login';
    state.authError = result.message;
    render();
  }

  async function submitMfa(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    await api.verifyMfa(data.code);
    state.authMode = 'login';
    state.authError = '';
    await hydrateRemote();
  }

  async function submitMfaEnrollment(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    await api.mfaEnrollVerify(data.code);
    state.mfaEnrollment = null;
    await loadMfaFactors();
  }

  async function submitPrescriptionEdit(form) {
    const values = formValues(form);
    const id = form.dataset.id;
    const index = state.prescriptions.findIndex((item) => item.id === id);
    if (index < 0) return;
    if (state.localOnly) state.prescriptions[index] = { ...state.prescriptions[index], ...values, updatedAt: new Date().toISOString() };
    else state.prescriptions[index] = (await api.updatePrescription(id, values)).prescription;
    state.editingPrescriptionId = '';
    saveLocal(state);
    render();
  }

  async function submitIndicationEdit(form) {
    const values = formValues(form);
    const patientId = form.dataset.patientId;
    const id = form.dataset.id;
    const records = state.doctorRecords[patientId];
    const index = records?.indications?.findIndex((item) => item.id === id) ?? -1;
    if (index < 0) return;
    if (state.localOnly) records.indications[index] = { ...records.indications[index], ...values };
    else records.indications[index] = (await api.updateIndication(patientId, id, values)).indication;
    state.editingIndicationId = '';
    render();
  }

  async function loadMfaFactors() {
    if (state.localOnly) return;
    try { const result = await api.mfaFactors(); state.mfaFactors = result.all || result.totp || []; } catch { state.mfaFactors = []; }
  }

  async function startMfaEnrollment() {
    const result = await api.mfaEnroll();
    state.mfaEnrollment = result.factor;
    render();
  }

  async function exportAccount(format = 'json') {
    const payload = format === 'csv' ? await api.exportAccountCsv() : JSON.stringify(await api.exportAccount(), null, 2);
    const blob = new Blob([payload], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = format === 'csv' ? 'medihuman-account-export.csv' : 'medihuman-account-export.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function selectRecordFile(file) {
    const problem = validateFile(file);
    if (problem) {
      state.recordUpload = { file: null, preview: '', progress: 0, error: problem, busy: false };
      render();
      return;
    }
    state.recordUpload = { file, preview: await readFilePreview(file), progress: 0, error: '', busy: false };
    render();
  }

  async function uploadRecord() {
    const upload = state.recordUpload || {};
    if (!upload.file || upload.busy) return;
    state.recordUpload = { ...upload, busy: true, progress: 0, error: '' };
    render();
    try {
      const response = await uploadRecordFile({
        file: upload.file,
        csrf: currentCsrfToken(),
        fields: { type: 'other', title: upload.file.name || 'Uploaded record', source: 'self' },
        onProgress: (progress) => { state.recordUpload = { ...state.recordUpload, progress }; render(); },
      });
      if (response.record) state.records = [response.record, ...(state.records || [])];
      state.recordUpload = { file: null, preview: '', progress: 0, error: '', busy: false };
      render();
    } catch (error) {
      state.recordUpload = { ...state.recordUpload, busy: false, error: error.message };
      render();
    }
  }

  function showAuthError(message) { const target = document.querySelector('#auth-error'); if (target) target.innerHTML = notice(escapeHtml(message), 'warning'); }

  function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }

  function showError(message) { state.errorMessage = escapeHtml(message); render(); }

  function clearError() { state.errorMessage = ''; }

  async function saveProfile() {
    const form = document.querySelector('[data-form="profile"]'); state.profile = formValues(form); state.saveStatus.profile = 'Saving…'; saveLocal(state); render();
    if (!state.localOnly) {
      try { const response = await api.saveProfile(state.profile); state.profile = response.profile || state.profile; state.saveStatus.profile = 'Saved to your account'; }
      catch (error) { state.saveStatus.profile = `Not saved: ${error.message}`; }
    } else state.saveStatus.profile = 'Saved on this device';
    render();
  }

  function updateMedicineField(target) { const item = state.medicines[Number(target.dataset.medIndex)]; if (item) { item[target.dataset.medKey] = target.value; state.dirty = true; saveLocal(state); } }

  function openMedicineDialog(mode, index = -1) {
    const item = mode === 'edit' ? state.medicines[index] : null;
    if (mode === 'edit' && !item) return;
    state.medicineDialog = { mode, index, draft: mode === 'edit' ? { ...item } : medicineObject('') };
    render();
    globalThis.document?.querySelector('.medicine-dialog input[name="name"]')?.focus();
  }

  function closeMedicineDialog() {
    const dialog = state.medicineDialog;
    state.medicineDialog = null;
    render();
    const trigger = dialog?.mode === 'edit'
      ? globalThis.document?.getElementById(`medicine-edit-${dialog.index}`)
      : globalThis.document?.getElementById('medicine-add-button');
    trigger?.focus();
  }

  async function submitMedicineDialog(form) {
    const dialog = state.medicineDialog;
    if (!dialog) return;
    const values = formValues(form);
    const draft = { ...(dialog.draft || {}), ...values };
    const name = String(draft.name || '').trim();
    if (!name) { showError('Medicine name is required.'); return; }
    const item = { ...draft, name, status: draft.status || 'active', id: draft.id || globalThis.crypto?.randomUUID?.() || `local-medicine-${Date.now()}` };
    if (dialog.mode === 'new') state.medicines.push(item);
    else if (state.medicines[dialog.index]) state.medicines[dialog.index] = item;
    state.medicineDialog = null;
    state.saveStatus.medicines = 'Saving…';
    saveLocal(state);
    render();
    const rowIndex = dialog.mode === 'new' ? state.medicines.length - 1 : dialog.index;
    globalThis.document?.getElementById(`medicine-edit-${rowIndex}`)?.focus();
    await saveMedicines();
  }

  async function saveMedicines() {
    state.medicines = state.medicines.filter((item) => item.name.trim()); state.saveStatus.medicines = 'Saving…'; saveLocal(state); render();
    if (!state.localOnly) {
      try { const response = await api.saveMedicines(state.medicines); state.medicines = response.medicines || state.medicines; state.saveStatus.medicines = 'Saved to your account'; state.dirty = false; }
      catch (error) { state.saveStatus.medicines = `Not saved: ${error.message}`; }
    } else { state.saveStatus.medicines = 'Saved on this device'; state.dirty = false; }
    render();
  }

  function goReconcile() { const fields = { prescribed: document.querySelector('#prescribed-list'), dispensed: document.querySelector('#dispensed-list') }; if (fields.prescribed) { state.prescriptionText = fields.prescribed.value; state.dispensedText = fields.dispensed.value; state.dirty = true; saveLocal(state); } }

  async function persistPrescriptionReview() {
    const lines = state.prescriptionText.split(/[\n,]+/).map((line) => line.trim()).filter(Boolean);
    const medicines = lines.slice(0, 100).map((medicationName) => ({ medicationName, instructions: 'Captured and reviewed by patient.' }));
    const record = {
      id: `local-prescription-${Date.now()}`,
      condition: '',
      date: new Date().toISOString().slice(0, 10),
      doctor: '',
      medicines,
      tests: [],
      fileRef: '',
      instructions: 'Captured and reviewed by patient.',
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (state.localOnly) {
      state.prescriptions.push(record);
      saveLocal(state);
      state.saveStatus.prescription = 'Saved on this device';
      state.dirty = false;
      return;
    }
    state.saveStatus.prescription = 'Saving…';
    try {
      const response = await api.savePrescription({ condition: '', medicines, tests: [], instructions: 'Captured and reviewed by patient.', notes: '' });
      if (response.prescription) state.prescriptions.push(response.prescription);
      state.saveStatus.prescription = 'Saved to your account';
      state.dirty = false;
    } catch (error) {
      state.saveStatus.prescription = `Not saved: ${error.message}`;
    }
  }

  async function saveReconciliation() {
    goReconcile();
    state.saveStatus.reconciliation = 'Saving…';
    render();
    const comparison = compareMedicines(state.prescriptionText, state.dispensedText);
    if (comparison.prescribed.length || comparison.dispensed.length) {
      const payload = { prescriptionMedicines: comparison.prescribed, dispensedMedicines: comparison.dispensed, notes: 'Reviewed in MediHuman.' };
      if (state.localOnly) {
        state.reconciliations.push({ id: `local-reconciliation-${Date.now()}`, ...payload, matched: comparison.matched, missing: comparison.missing, unexpected: comparison.unexpected, isExactMatch: comparison.isExactMatch, createdAt: new Date().toISOString() });
        state.saveStatus.reconciliation = 'Saved on this device';
        saveLocal(state);
      } else {
        try {
          const response = await api.saveReconciliation(payload);
          if (response.reconciliation) state.reconciliations.push(response.reconciliation);
          state.saveStatus.reconciliation = 'Saved to your account';
        } catch (error) { state.saveStatus.reconciliation = `Not saved: ${error.message}`; }
      }
    } else state.saveStatus.reconciliation = 'Nothing to save';
    state.view = 'reconcile'; render();
  }

  async function startCamera() {
    state.cameraError = '';
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    if (!window.isSecureContext && !isLocal) {
      state.cameraError = 'Camera access requires HTTPS. Open this app through its HTTPS deployment, or use Upload photo / Manual entry.';
      render();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      state.cameraError = 'This browser does not expose camera access. Check browser support, then use Upload photo or Manual entry.';
      render();
      return;
    }
    const constraints = [
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false },
    ];
    let lastError;
    for (const constraint of constraints) {
      try {
        state.cameraStream = await navigator.mediaDevices.getUserMedia(constraint);
        render();
        return;
      } catch (error) {
        lastError = error;
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') break;
      }
    }
    state.cameraStream = null;
    const errorMessages = {
      NotAllowedError: 'Camera permission is blocked. Allow camera access for this site in browser settings, then try again.',
      NotFoundError: 'No camera was found. Check that a camera is connected, then use Upload photo or Manual entry.',
      NotReadableError: 'The camera is busy in another app. Close that app and try again.',
      SecurityError: 'Camera access is blocked by browser security. Use HTTPS and check site permissions.',
      OverconstrainedError: 'This camera does not support the requested mode. Try again or use Upload photo.',
    };
    state.cameraError = errorMessages[lastError?.name] || 'Camera could not start. Check HTTPS, browser permissions, and whether another app is using the camera.';
    render();
  }

  function stopCamera() { state.cameraStream?.getTracks().forEach((track) => track.stop()); state.cameraStream = null; render(); }

  function applyOcrResult(result) {
    state.ocrResult = result || null;
    state.ocrText = result?.text || '';
    state.ocrAnalysis = state.ocrText ? analyzePrescriptionText(state.ocrText) : null;
    state.ocrConfirmed = false;
  }

  async function captureCamera() {
    const video = document.querySelector('#camera-video'); if (!video || video.readyState < 2) return;
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0); state.scanSource = 'Camera capture · manual confirmation required';
    try {
      const result = await ocr.recognize(canvas);
      applyOcrResult(result);
      state.view = 'review'; state.scanSeen = true;
    } catch {
      applyOcrResult(null);
      state.cameraError = 'OCR could not read this frame. Review the prescription manually or capture a clearer image.';
      state.view = 'scan';
    }
    stopCamera();
  }

  async function readPhoto(file) {
    if (!file) return;
    state.scanSource = 'Uploaded photo · manual confirmation required';
    try {
      const result = await ocr.recognize(file);
      applyOcrResult(result);
      state.view = 'review';
      state.scanSeen = true;
    } catch {
      applyOcrResult(null);
      state.cameraError = 'OCR could not read this image. Review it manually or try a clearer, well-lit photo.';
      state.view = 'scan';
    }
    render();
  }

  function submitQuestion(form) { const values = formValues(form); if (values.question?.trim()) { state.questions.push({ title: values.question.trim(), meta: 'Personal note · stored locally' }); saveLocal(state); render(); } }

  async function requestPatient(form) {
    const patientId = formValues(form).patientId?.trim();
    if (!patientId) return;
    state.requesting = true;
    render();
    try {
      if (state.localOnly) {
        const existing = state.doctorRequests.find((request) => request.patientId === patientId && ['pending', 'approved'].includes(request.status));
        if (existing) throw new Error('An active request already exists for this patient.');
        state.doctorRequests.push({ id: `local-request-${Date.now()}`, patientId, status: 'pending', requestedAt: new Date().toISOString(), doctor: state.doctorProfile });
        state.patientRequests.push({ id: state.doctorRequests.at(-1).id, patientId, status: 'pending', requestedAt: new Date().toISOString(), doctor: state.doctorProfile });
        saveLocal(state);
      } else {
        const response = await api.requestPatient(patientId);
        state.doctorRequests = [response.request, ...state.doctorRequests];
      }
      render();
    } catch (error) { showError(error.message); }
    finally { state.requesting = false; render(); }
  }

  async function cancelRequest(requestId) {
    try {
      if (state.localOnly) {
        state.doctorRequests = state.doctorRequests.filter((item) => item.id !== requestId);
        state.patientRequests = state.patientRequests.filter((item) => item.id !== requestId);
        saveLocal(state);
      } else {
        await api.deleteAccessRequest(requestId);
        state.doctorRequests = state.doctorRequests.filter((item) => item.id !== requestId);
      }
      render();
    } catch (error) { showError(error.message); }
  }

  async function submitIndication(form) {
    const values = formValues(form);
    const patientId = form.dataset.patientId || state.selectedPatientId;
    if (!patientId || !values.title?.trim() || !values.detail?.trim()) return;
    try {
      const payload = { title: values.title.trim(), detail: values.detail.trim(), severity: values.severity || 'info' };
      if (state.localOnly) {
        const indication = { id: `local-indication-${Date.now()}`, ...payload, createdAt: new Date().toISOString(), doctor: state.doctorProfile };
        state.indications.push(indication);
        state.notifications.unshift({ id: `local-notification-${Date.now()}`, type: 'doctor-indication', title: 'New clinician indication', message: 'A clinician added an indication to your record.', entityType: 'indication', entityId: indication.id, readAt: null, createdAt: indication.createdAt });
        state.doctorRecords[patientId] ||= { profile: {}, medicines: [], prescriptions: [], reconciliations: [], indications: [] };
        state.doctorRecords[patientId].indications ||= [];
        state.doctorRecords[patientId].indications.push(indication);
        saveLocal(state);
      } else {
        const response = await api.addIndication(patientId, payload);
        state.doctorRecords[patientId] ||= { profile: {}, medicines: [], prescriptions: [], reconciliations: [], indications: [] };
        state.doctorRecords[patientId].indications ||= [];
        if (response.indication) state.doctorRecords[patientId].indications.push(response.indication);
      }
      render();
    } catch (error) { showError(error.message); }
  }

  async function updateCareRequest(requestId, status) {
    try {
      if (state.localOnly) {
        const request = state.patientRequests.find((item) => item.id === requestId);
        if (!request) return;
        request.status = status;
        request.respondedAt = new Date().toISOString();
        if (status === 'revoked') request.revokedAt = request.respondedAt;
        const doctorRequest = state.doctorRequests.find((item) => item.id === requestId);
        if (doctorRequest) Object.assign(doctorRequest, request);
        saveLocal(state);
      } else {
        const response = await api.updateAccessRequest(requestId, status);
        state.patientRequests = state.patientRequests.map((request) => request.id === requestId ? response.request : request);
      }
      render();
    } catch (error) { showError(error.message); }
  }

  function localPatientRecords() {
    return { profile: { ...state.profile, patientId: state.profile.patientId || state.user?.patientId }, medicines: state.medicines, prescriptions: [], reconciliations: [] };
  }

  async function loadDoctorPatient(patientId = state.selectedPatientId) {
    if (!patientId) return;
    try {
      state.selectedPatientId = patientId;
      state.doctorRecords[patientId] = state.localOnly ? localPatientRecords() : await api.doctorPatient(patientId);
      // Paint the record first. The rule-based summary is a second round trip
      // and must not delay the clinician from seeing the approved record.
      render();
      if (!state.localOnly) {
        try { const summary = await api.doctorPatient(patientId, 'summary'); state.doctorRecords[patientId].summary = summary.summary; render(); } catch { /* record remains useful without summary endpoint */ }
      }
    } catch (error) { showError(error.message); }
  }

  /** Open the record of the patient a clinician is looking at, defaulting to the first approved one. */
  function clearLocalWorkspace() {
    sessionStorage.removeItem(LOCAL_KEY);
    state.profile = emptyProfile(); state.medicines = []; state.prescriptionText = ''; state.dispensedText = ''; state.questions = [];
    state.patientRequests = []; state.doctorRequests = []; state.doctorRecords = {}; state.prescriptions = []; state.reconciliations = []; state.indications = []; state.notifications = []; state.consent = false; state.profile.patientId = '';
  }

  function exitLocal(clear = false) {
    stopCamera();
    if (clear) clearLocalWorkspace();
    setLocalMode(false);
    state.localExitPrompt = false; state.screen = 'auth'; state.localOnly = false; state.user = null; state.role = state.authRole; state.view = 'dashboard'; state.profileMenuOpen = false; state.notificationsOpen = false; state.patientMenuOpen = false; state.doctorPatientMenuOpen = false; state.medicineDialog = null; state.mobileMenuOpen = false;
    render();
  }

  root.addEventListener('click', async (event) => {
    if (state.medicineDialog && event.target.classList?.contains('modal-backdrop')) { closeMedicineDialog(); return; }
    const target = event.target.closest('[data-action]');
    if (state.doctorPatientMenuOpen && !event.target.closest('.patient-picker')) { state.doctorPatientMenuOpen = false; render(); }
    if (!target) return; const action = target.dataset.action;
    if (action === 'auth-login' || action === 'auth-register') { state.authMode = action === 'auth-register' ? 'register' : 'login'; render(); return; }
    if (action === 'clear-error') { clearError(); render(); return; }
    if (action === 'auth-recover') { state.authMode = 'recover'; state.authError = ''; render(); return; }
    if (action === 'mfa-enroll') { await startMfaEnrollment(); return; }
    if (action === 'export-account') { await exportAccount(); return; }
    if (action === 'export-account-csv') { await exportAccount('csv'); return; }
    if (action === 'delete-account') { if (!window.confirm('Permanently delete your MediHuman account and records?')) return; const confirmation = window.prompt('Type DELETE MY ACCOUNT to confirm.'); if (confirmation) { await api.deleteAccount(confirmation); await api.logout().catch(() => undefined); state.screen = 'auth'; state.user = null; state.localOnly = false; render(); } return; }
    if (action === 'mfa-remove') { await api.mfaRemove(target.dataset.id); await loadMfaFactors(); render(); return; }
    if (action === 'edit-prescription') { state.editingPrescriptionId = target.dataset.id; render(); return; }
    if (action === 'cancel-prescription-edit') { state.editingPrescriptionId = ''; render(); return; }
    if (action === 'view-prescription') { state.viewingPrescriptionId = target.dataset.id; render(); return; }
    if (action === 'cancel-prescription-view') { state.viewingPrescriptionId = ''; render(); return; }
    if (action === 'delete-prescription') { if (!window.confirm('Remove this prescription record?')) return; if (state.localOnly) { state.prescriptions = state.prescriptions.filter((item) => item.id !== target.dataset.id); saveLocal(state); } else { await api.deletePrescription(target.dataset.id); state.prescriptions = state.prescriptions.filter((item) => item.id !== target.dataset.id); } render(); return; }
    if (action === 'delete-record') { if (!window.confirm('Remove this record?')) return; if (state.localOnly) { state.records = state.records.filter((item) => item.id !== target.dataset.id); saveLocal(state); } else { await api.deleteRecord(target.dataset.id); state.records = state.records.filter((item) => item.id !== target.dataset.id); } render(); return; }
    if (action === 'add-record') {
      const title = window.prompt('Record title:');
      if (!title) return;
      const type = window.prompt('Record type (prescription, lab_report, imaging, clinical_note, vaccination, other):', 'other') || 'other';
      const description = window.prompt('Description (optional):') || '';
      const date = new Date().toISOString().slice(0, 10);
      try {
        if (state.localOnly) {
          state.records.push({ id: `local-record-${Date.now()}`, type, title, date, description, fileRef: '', tags: [], source: 'self', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          saveLocal(state);
        } else {
          const response = await api.saveRecord({ type, title, date, description, tags: [], source: 'self' });
          if (response.record) state.records.push(response.record);
        }
        render();
      } catch (error) { showError(error.message); }
      return;
    }
    if (action === 'edit-indication') { state.editingIndicationId = target.dataset.id; render(); return; }
    if (action === 'cancel-indication-edit') { state.editingIndicationId = ''; render(); return; }
    if (action === 'delete-indication') { if (!window.confirm('Remove this clinician indication?')) return; const patientId = target.dataset.patientId; await api.deleteIndication(patientId, target.dataset.id); state.doctorRecords[patientId].indications = state.doctorRecords[patientId].indications.filter((item) => item.id !== target.dataset.id); render(); return; }
    if (action === 'auth-role') { state.authRole = target.dataset.role === 'doctor' ? 'doctor' : 'patient'; state.authRoleExplicit = true; render(); return; }
    if (action === 'local-mode') { enterLocal(); return; }
    if (action === 'toggle-menu') { state.mobileMenuOpen = !state.mobileMenuOpen; render(); return; }
    if (action === 'toggle-profile-menu') { state.profileMenuOpen = !state.profileMenuOpen; state.notificationsOpen = false; render(); return; }
    if (action === 'toggle-patient-menu') { state.patientMenuOpen = !state.patientMenuOpen; render(); return; }
    if (action === 'toggle-doctor-patient-menu') {
      state.doctorPatientMenuOpen = !state.doctorPatientMenuOpen;
      render();
      if (state.doctorPatientMenuOpen) {
        const options = [...document.querySelectorAll('.patient-picker-option')];
        (options.find((option) => option.getAttribute('aria-selected') === 'true') || options[0])?.focus();
      } else document.querySelector('.patient-picker-trigger')?.focus();
      return;
    }
    if (action === 'doctor-select-patient') {
      const patientId = target.dataset.patientId;
      if (!patientId) return;
      state.doctorPatientMenuOpen = false;
      if (target.dataset.view) state.view = target.dataset.view;
      state.selectedPatientId = patientId;
      await loadDoctorPatient(patientId);
      document.querySelector('.patient-picker-trigger')?.focus();
      return;
    }
    if (action === 'doctor-open-patient') {
      const patientId = target.dataset.patientId;
      if (!patientId) return;
      state.doctorPatientMenuOpen = false;
      state.selectedPatientId = patientId;
      // Opening an approved patient from the dashboard lands on their record.
      state.view = target.dataset.view || 'doctor-patients';
      render();
      await loadDoctorPatient(patientId);
      render();
      return;
    }
    if (action === 'toggle-notifications') {
      state.notificationsOpen = !state.notificationsOpen;
      state.profileMenuOpen = false;
      if (state.notificationsOpen && !state.localOnly) {
        try { const response = await api.notifications(); state.notifications = response.notifications || state.notifications; } catch { /* existing notifications remain visible */ }
      }
      render();
      return;
    }
    if (action === 'mark-notification-read') {
      const notification = state.notifications.find((item) => item.id === target.dataset.id);
      if (notification && !notification.readAt) {
        notification.readAt = new Date().toISOString();
        if (!state.localOnly) { try { await api.markNotificationRead(notification.id); } catch { /* local read state still improves current view */ } }
        saveLocal(state);
      }
      const view = target.dataset.view;
      if (view) { state.view = view; state.notificationsOpen = false; state.profileMenuOpen = false; state.mobileMenuOpen = false; }
      render();
      return;
    }
    if (action === 'nav') {
      state.view = target.dataset.view; state.patientMenuOpen = false; state.profileMenuOpen = false; state.notificationsOpen = false; state.doctorPatientMenuOpen = false; state.medicineDialog = null; state.mobileMenuOpen = false;
      if (state.view === 'doctor-patients' && state.role === 'doctor' && !state.selectedPatientId) {
        const firstApproved = state.doctorRequests.find((request) => request.status === 'approved');
        if (firstApproved) state.selectedPatientId = firstApproved.patientId;
      }
      render();
      return;
    }
    if (action === 'privacy') { state.view = 'privacy'; state.profileMenuOpen = false; state.notificationsOpen = false; state.doctorPatientMenuOpen = false; state.mobileMenuOpen = false; render(); return; }
    if (action === 'logout') { if (state.localOnly) { state.localExitPrompt = true; state.profileMenuOpen = false; state.notificationsOpen = false; state.mobileMenuOpen = false; render(); return; } stopCamera(); try { await api.logout(); } catch { /* clear UI regardless */ } setLocalMode(false); state.screen = 'auth'; state.user = null; state.localOnly = false; state.role = state.authRole; state.view = 'dashboard'; state.notificationsOpen = false; state.mobileMenuOpen = false; render(); return; }
    if (action === 'local-exit-preserve') { exitLocal(false); return; }
    if (action === 'local-exit-clear') { exitLocal(true); return; }
    if (action === 'local-exit-cancel') { state.localExitPrompt = false; render(); return; }
    if (action === 'go-scan') { state.view = 'scan'; render(); return; }
    if (action === 'go-reconcile') { state.view = 'reconcile'; render(); return; }
    if (action === 'go-composition') { state.view = 'composition'; render(); return; }
    if (action === 'toggle-records-sort') { state.recordsSort = state.recordsSort === 'asc' ? 'desc' : 'asc'; render(); return; }
    if (action === 'upload-record') { await uploadRecord(); return; }
    if (action === 'save-profile') { await saveProfile(); return; }
    if (action === 'add-medicine') { openMedicineDialog('new'); return; }
    if (action === 'edit-medicine') { openMedicineDialog('edit', Number(target.dataset.index)); return; }
    if (action === 'close-medicine-dialog') { closeMedicineDialog(); return; }
    if (action === 'remove-medicine') { if (!window.confirm('Remove this medicine?')) return; const index = Number(target.dataset.index); const item = state.medicines[index]; if (!item) return; if (!state.localOnly && item.id) { try { await api.deleteMedicine(item.id); } catch (error) { state.saveStatus.medicines = `Not saved: ${error.message}`; render(); return; } } state.medicines.splice(index, 1); saveLocal(state); state.saveStatus.medicines = 'Saved to your account'; state.dirty = false; render(); return; }
    if (action === 'discontinue-medicine') { const index = Number(target.dataset.index); const item = state.medicines[index]; if (!item) return; item.status = 'discontinued'; item.stoppedAt = new Date().toISOString().slice(0, 10); state.dirty = true; saveLocal(state); render(); return; }
    if (action === 'complete-medicine') { const index = Number(target.dataset.index); const item = state.medicines[index]; if (!item) return; item.status = 'completed'; item.stoppedAt = new Date().toISOString().slice(0, 10); state.dirty = true; saveLocal(state); render(); return; }
    if (action === 'reactivate-medicine') { const index = Number(target.dataset.index); const item = state.medicines[index]; if (!item) return; item.status = 'active'; item.stoppedAt = ''; state.dirty = true; saveLocal(state); render(); return; }
    if (action === 'save-medicines') { await saveMedicines(); return; }
    if (action === 'camera-start') { await startCamera(); return; }
    if (action === 'camera-stop') { stopCamera(); return; }
    if (action === 'camera-capture') { await captureCamera(); return; }
    if (action === 'manual-review') { state.prescriptionText = document.querySelector('#manual-prescription')?.value || ''; state.ocrText = state.prescriptionText; state.scanSource = 'Manual entry'; state.ocrResult = null; state.ocrAnalysis = null; state.ocrConfirmed = true; state.view = 'review'; state.scanSeen = true; state.dirty = true; saveLocal(state); render(); return; }
     if (action === 'save-review') {
      const confirmed = Boolean(document.querySelector('#ocr-review-confirmed')?.checked);
      if ((state.ocrAnalysis?.checkCount || 0) > 0 && !confirmed) {
        showError('Check the flagged lines against the original document, then confirm before saving.');
        document.querySelector('#ocr-review-confirmed')?.focus();
        return;
      }
      state.prescriptionText = document.querySelector('#review-text')?.value || ''; state.dirty = true; state.view = 'reconcile'; state.scanSeen = true; saveLocal(state); await persistPrescriptionReview(); render(); return;
    }
    if (action === 'run-reconcile') { await saveReconciliation(); return; }
    if (action === 'reopen-reconciliation') { const record = state.reconciliations.find((item) => item.id === target.dataset.id); if (record) { state.prescriptionText = (record.prescriptionMedicines || []).join('\n'); state.dispensedText = (record.dispensedMedicines || []).join('\n'); state.view = 'reconcile'; render(); } return; }
    if (action === 'delete-reconciliation') { if (!window.confirm('Remove this reconciliation record?')) return; if (state.localOnly) { state.reconciliations = state.reconciliations.filter((item) => item.id !== target.dataset.id); saveLocal(state); } else { await api.deleteReconciliation(target.dataset.id); state.reconciliations = state.reconciliations.filter((item) => item.id !== target.dataset.id); } render(); return; }
    if (action === 'care-request') { await updateCareRequest(target.dataset.id, target.dataset.status); return; }
    if (action === 'cancel-request') { await cancelRequest(target.dataset.id); return; }
    if (action === 'doctor-refresh-patient') { await loadDoctorPatient(); return; }
    if (action === 'remove-question') { if (!window.confirm('Remove this question?')) return; state.questions.splice(Number(target.dataset.index), 1); saveLocal(state); render(); return; }
    if (action === 'save-consent') { state.consent = Boolean(document.querySelector('#consent-toggle')?.checked); saveLocal(state); if (!state.localOnly) await api.saveConsent(state.consent); render(); return; }
    if (action === 'clear-data') { if (window.confirm('Clear this browser’s MediHuman workspace?')) { clearLocalWorkspace(); saveLocal(state); render(); } }
  });

   root.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.target; try { if (form.dataset.form === 'auth') await submitAuth(form); if (form.dataset.form === 'password-reset') await submitPasswordReset(form); if (form.dataset.form === 'mfa') await submitMfa(form); if (form.dataset.form === 'mfa-enrollment') await submitMfaEnrollment(form); if (form.dataset.form === 'prescription-edit') await submitPrescriptionEdit(form); if (form.dataset.form === 'indication-edit') await submitIndicationEdit(form); if (form.dataset.form === 'medicine-dialog') await submitMedicineDialog(form); if (form.dataset.form === 'profile') await saveProfile(); if (form.dataset.form === 'question') submitQuestion(form); if (form.dataset.form === 'doctor-request') await requestPatient(form); if (form.dataset.form === 'doctor-indication') await submitIndication(form); } catch (error) { state.authError = error.message; render(); } });
  root.addEventListener('input', (event) => { if (event.target.matches('[data-med-index]')) updateMedicineField(event.target); if (event.target.id === 'medicine-filter') { state.medicineFilter = event.target.value; render(); } if (event.target.id === 'patient-search') { state.patientSearch = event.target.value; state.selectedPatientId = ''; render(); } if (event.target.id === 'records-search') { state.recordsFilter = event.target.value; render(); } if (event.target.id === 'records-from') { state.recordsFromDate = event.target.value; render(); } if (event.target.id === 'records-to') { state.recordsToDate = event.target.value; render(); } });
  root.addEventListener('change', (event) => { if (event.target.id === 'prescription-file') readPhoto(event.target.files?.[0]); if (event.target.matches('[data-med-index]')) updateMedicineField(event.target); if (event.target.id === 'record-type-filter') { state.recordTypeFilter = event.target.value; render(); } if (event.target.id === 'records-type-filter') { state.recordsTypeFilter = event.target.value; render(); } if (event.target.id === 'record-file' || event.target.id === 'record-camera-file') selectRecordFile(event.target.files?.[0]); });
  root.addEventListener('keydown', (event) => {
    if (state.doctorPatientMenuOpen && event.key === 'Escape') { state.doctorPatientMenuOpen = false; render(); globalThis.document?.querySelector('.patient-picker-trigger')?.focus(); return; }
    if (state.doctorPatientMenuOpen && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const options = [...globalThis.document?.querySelectorAll('.patient-picker-option') || []];
      if (!options.length) return;
      const current = options.indexOf(globalThis.document.activeElement);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? options.length - 1
          : event.key === 'ArrowDown' ? (current < 0 ? 0 : (current + 1) % options.length)
            : (current <= 0 ? options.length - 1 : current - 1);
      event.preventDefault();
      options[next].focus();
      return;
    }
    if (event.key === 'Escape') {
      if (state.medicineDialog) { closeMedicineDialog(); return; }
      if (state.localExitPrompt) { state.localExitPrompt = false; render(); return; }
      if (state.mobileMenuOpen || state.patientMenuOpen || state.profileMenuOpen || state.notificationsOpen) { state.mobileMenuOpen = false; state.patientMenuOpen = false; state.profileMenuOpen = false; state.notificationsOpen = false; render(); }
    }
    if (event.key === 'Tab') {
      const container = state.medicineDialog
        ? globalThis.document?.querySelector('.medicine-dialog')
        : state.localExitPrompt
          ? globalThis.document?.querySelector('.local-exit-dialog')
          : state.mobileMenuOpen ? globalThis.document?.querySelector('#sidebar') : null;
      if (!container) return;
      const items = [...container.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.disabled && element.getClientRects().length);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', (event) => {
      if (state.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  return { enterLocal, hydrateRemote, render };
}
