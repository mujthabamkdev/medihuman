/** UI primitives, icons, and stable display copy. */

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

const ICON_PATHS = {
  home: '<path d="m3.5 10 8.5-6.5 8.5 6.5v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M9 20.5v-6h6v6"/>',
  profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.8-3.4 3.3-5 7.5-5s6.7 1.6 7.5 5"/>',
  medicines: '<path d="M8.5 4.5a4 4 0 0 1 5.7 0l5.3 5.3a4 4 0 0 1-5.7 5.7l-5.3-5.3a4 4 0 0 1 0-5.7Z"/><path d="m10.5 6.5 7 7"/>',
  scan: '<rect x="5" y="6" width="14" height="12" rx="2"/><path d="M8 4v2M16 4v2M8 18v2M16 18v2M8 10h8M8 13h5"/>',
  'care-team': '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.5 20c.5-3.2 2.3-5 5.5-5s5 1.8 5.5 5M15 15c2.8 0 4.6 1.5 5 4"/>',
  questions: '<path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><path d="M8 10h8M8 13h5"/>',
  support: '<path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z"/><path d="M12 10v4M10 12h4"/>',
  privacy: '<path d="M12 3.5 19 6v5.2c0 4.6-2.8 7.7-7 9.3-4.2-1.6-7-4.7-7-9.3V6z"/><path d="m8.8 12 2.1 2.1 4.3-4.3"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  signout: '<path d="M10 5H5.5a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 5.5 19H10"/><path d="M14 8l4 4-4 4M9 12h9"/>',
  spark: '<path d="m12 3 1.5 6.5L20 12l-6.5 2.5L12 21l-1.5-6.5L4 12l6.5-2.5z"/>',
  document: '<path d="M7 3.5h7l4 4V20.5H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M14 3.5v4h4M8.5 12h5M8.5 15h5"/>',
  arrow: '<path d="M5 12h13M13 7l5 5-5 5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  safety: '<path d="M12 3.5 19 6v5.2c0 4.6-2.8 7.7-7 9.3-4.2-1.6-7-4.7-7-9.3V6z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>',
  edit: '<path d="m5 16.5-.8 3.3 3.3-.8L18 8.5 15.5 6z"/><path d="m14.5 7 2.5 2.5"/>',
  compare: '<path d="M6 5v14M18 5v14M3.5 8.5H8.5M15.5 15.5h5M8 6.5l2-1.5-2-1.5M16 16.5l-2 1.5 2 1.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v5M12 7.5h.01"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/>',
};

export function svgIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ICON_PATHS.info}</svg>`;
}

export function brandIcon() {
  return '<svg class="brand-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="currentColor"/><circle cx="16" cy="8.4" r="2.25" fill="#fff"/><path d="M8.4 22.5v-8l7.6 5.8 7.6-5.8v8" fill="none" stroke="#fff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 11.3c1.55-1.25 3.42-1.9 5.5-1.9s3.95.65 5.5 1.9" fill="none" stroke="#9fdcd0" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

export function googleIcon() {
  return '<svg class="auth-google-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.35 12.27c0-.79-.07-1.55-.23-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.42Z"/><path fill="#34A853" d="M12 21.5c2.6 0 4.78-.86 6.37-2.33l-3.14-2.45c-.87.58-1.98.93-3.23.93-2.49 0-4.6-1.68-5.36-3.94H3.4v2.53A9.62 9.62 0 0 0 12 21.5Z"/><path fill="#FBBC05" d="M6.64 13.71A5.78 5.78 0 0 1 6.34 12c0-.59.1-1.17.3-1.71V7.76H3.4A9.52 9.52 0 0 0 2.5 12c0 1.53.37 2.98.9 4.24l3.24-2.53Z"/><path fill="#EA4335" d="M12 6.35c1.42 0 2.69.49 3.69 1.45l2.76-2.76C16.77 3.42 14.6 2.5 12 2.5a9.62 9.62 0 0 0-8.6 5.26l3.24 2.53C7.4 8.03 9.51 6.35 12 6.35Z"/></svg>';
}

export function initials(state) {
  const name = state.profile.fullName || state.doctorProfile?.displayName || state.user?.email || 'MH';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function notice(text, kind = 'info') { return `<div class="notice notice-${kind}" role="${kind === 'warning' ? 'alert' : 'status'}" aria-live="${kind === 'warning' ? 'assertive' : 'polite'}"><span class="notice-icon">${kind === 'warning' ? '!' : 'i'}</span><span>${text}</span></div>`; }
export function button(label, action, className = 'button button-primary', extra = '') { return `<button type="button" class="${className}" data-action="${action}" ${extra}>${label}</button>`; }
