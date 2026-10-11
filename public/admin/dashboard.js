/* =====================================================================
 * MediCare Admin Dashboard — dashboard.js
 * Vanilla JS (IIFE), no framework, no build step.
 *
 * Responsibilities:
 *   - Auth guard (token in localStorage; 401 → clear + redirect to login.html)
 *   - Mode toggle (Clinical / Technical) → switches the sidebar nav set
 *   - View routing for the SPA
 *   - Every CLINICAL section built out:
 *       1. Dashboard   2. Alerts       3. Patients (list + detail with 5 tabs)
 *       4. Consultations   5. Appointments   6. Treatment Plans
 *       7. Catalogs (5 tabs)   8. Thresholds   9. Working Hours
 *       10. Profile   11. Settings
 *   - TECHNICAL sections as "Coming soon" placeholders:
 *       Metrics · Request Logs · Audit Trail · Backup
 *   - Data fetching via RELATIVE paths only (no host / port hardcoded).
 *   - Rendering: KPI cards, charts, tables, modals, toasts, skeletons.
 *
 * Token: localStorage key `medicare_admin_token`
 * User : localStorage key `medicare_admin_user`
 * ===================================================================== */
(function () {
  'use strict';

  /* =========================================================
   * Constants
   * ========================================================= */
  const API = '/api/v1';
  const TOKEN_KEY = 'medicare_admin_token';
  const USER_KEY = 'medicare_admin_user';
  const MODE_KEY = 'medicare_admin_mode';
  const HEALTH_INTERVAL_MS = 30000;
  const ALERT_POLL_INTERVAL_MS = 30000; // spec: poll /admin/alerts/unread-count every 30s
  const SEARCH_DEBOUNCE_MS = 300;

  /* =========================================================
   * Tiny DOM helpers
   * ========================================================= */
  const $id = (id) => document.getElementById(id);
  const $qs = (sel, root) => (root || document).querySelector(sel);
  const $qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('data-')) node.setAttribute(k, v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else node.setAttribute(k, typeof v === 'boolean' ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
      else node.appendChild(c);
    }
    return node;
  }
  function svg(pathMarkup, classes = 'w-4 h-4', viewBox = '0 0 24 24') {
    return '<svg class="' + classes + '" xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + pathMarkup + '</svg>';
  }
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }
  function initials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function ageFromBirth(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age >= 0 && age < 130 ? age : null;
  }
  function relativeTime(iso) {
    if (!iso) return '—';
    // created_at may be UTC seconds without tz suffix; treat as UTC.
    let s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) s = s + 'Z';
    const then = new Date(s);
    if (isNaN(then.getTime())) return String(iso);
    const diff = (Date.now() - then.getTime()) / 1000;
    if (diff < 30) return 'just now';
    if (diff < 60) return Math.floor(diff) + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 2592000) return Math.floor(diff / 86400) + 'd ago';
    return then.toISOString().slice(0, 10);
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    let s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) s = s + 'Z';
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(iso);
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toISOString().slice(0, 10);
  }

  /* =========================================================
   * Icons (inline SVG strings)
   * ========================================================= */
  const ICONS = {
    dashboard:   '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    alerts:      '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    users:       '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user:        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    consults:    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    calendar:    '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    treatment:   '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><path d="M3 12h6"/>',
    catalogs:    '<path d="M4 4v6h6V4z"/><path d="M14 4v6h6V4z"/><path d="M4 14v6h6v-6z"/><path d="M14 14v6h6v-6z"/>',
    thresholds:  '<path d="M3 12h4l3-9 4 18 3-9h4"/>',
    clock:       '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    settings:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    bell:        '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    logout:      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    eye:         '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    pencil:      '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash:       '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    close:       '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    check:       '<polyline points="20 6 9 17 4 12"/>',
    refresh:     '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
    chevronRight:'<polyline points="9 18 15 12 9 6"/>',
    download:    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    backup:      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    stethoscope: '<path d="M4 4v6a4 4 0 0 0 8 0V4"/><path d="M8 14v2a4 4 0 0 0 8 0v-1"/><circle cx="20" cy="11" r="2"/>',
    activity:    '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    cpu:         '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
    database:    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    lock:        '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    mail:        '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
    clipboard:   '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
    search:      '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    plus:        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    arrowUp:     '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    arrowDown:   '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    minus:       '<line x1="5" y1="12" x2="19" y2="12"/>',
    backArrow:   '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    phone:       '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
    key:         '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    shield:      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    whatsapp:    '<path d="M3 21l1.9-5.7a8.5 8.5 0 1 1 3.7 3.6L3 21"/><path d="M9 9a1 1 0 0 0 0 0"/>',
    file:        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    image:       '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    edit:        '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    pill:        '<path d="M10.5 20.5a7 7 0 0 1-9.9-9.9l9.9 9.9z"/><path d="m8.5 8.5 7 7"/><path d="M20.5 10.5a7 7 0 0 1-9.9 9.9l9.9-9.9z"/>',
    chartDonut:  '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>',
    list:        '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    send:        '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'
  };

  /* =========================================================
   * State
   * ========================================================= */
  const state = {
    mode: 'clinical', // 'clinical' | 'technical'
    view: 'dashboard',
    prevView: null,
    token: null,
    user: null,
    backendStatus: 'unknown',
    unreadAlerts: 0,
    metrics: null,
    settings: null,
    backupInfo: null,
    charts: { statusDonut: null, statusData: null, topEndpoints: null },
    // Clinical view-state containers (kept compact)
    alerts: { data: [], loading: false, page: 1, limit: 25, severity: '', status: 'unread', pagination: null },
    patients: { data: [], loading: false, search: '', page: 1, limit: 10, pagination: null },
    patientDetail: { userId: null, user: null, summary: null, activeTab: 'records', records: [], recordsPage: 1, recordsLimit: 10, recordsPagination: null, documents: [], consultations: [], appointments: [], treatmentPlan: null, treatmentVersions: [], loading: false },
    consultations: { data: [], loading: false, page: 1, limit: 25, status: 'pending', pagination: null },
    appointments: { data: [], loading: false, page: 1, limit: 25, status: '', pagination: null },
    treatmentPlans: { patient: null, plan: null, versions: [], loading: false, patientSearch: '', patientResults: [] },
    catalogs: { activeCatalog: 'diseases', data: [], loading: false, page: 1, limit: 25, pagination: null, search: '' },
    thresholds: { data: [], loading: false },
    workingHours: { rows: [], availability: 'active', loading: false },
    profile: { loading: false },
    healthTimer: null,
    alertTimer: null,
    sidebarOpen: false,
  };

  /* =========================================================
   * Token + User storage
   * ========================================================= */
  function getToken() { return state.token || localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { state.token = t; if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
  function setUser(u) { state.user = u; if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY); }
  function loadStoredUser() {
    try { const raw = localStorage.getItem(USER_KEY); if (raw) state.user = JSON.parse(raw); } catch { state.user = null; }
  }

  /* =========================================================
   * API request helpers — RELATIVE paths only.
   * On 401 → clear token + redirect to login.html.
   * ========================================================= */
  async function apiRequest(path, opts = {}) {
    const token = getToken();
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      handle401();
      const err = new Error('AUTH_REQUIRED');
      err.auth = true;
      throw err;
    }
    return res;
  }
  async function apiJson(path, opts = {}) {
    const res = await apiRequest(path, opts);
    let body = null;
    const text = await res.text();
    if (text) {
      try { body = JSON.parse(text); } catch { body = { success: false, error: { code: 'PARSE_ERROR', message: 'Invalid JSON response from server.' } }; }
    }
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || ('Request failed (HTTP ' + res.status + ')');
      const err = new Error(msg);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    if (body && body.success === false) {
      throw new Error((body.error && body.error.message) || 'Unknown error');
    }
    return body;
  }
  function handle401() {
    setToken(null);
    setUser(null);
    if (state.healthTimer) clearInterval(state.healthTimer);
    if (state.alertTimer) clearInterval(state.alertTimer);
    toast('Session expired. Please sign in again.', 'error');
    setTimeout(() => { window.location.href = 'login.html'; }, 250);
  }

  /* =========================================================
   * Toasts (top-right stack, auto-dismiss 4s)
   * ========================================================= */
  function toast(message, type = 'info', title = null) {
    const stack = $id('toast-stack');
    if (!stack) return;
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.setAttribute('role', 'alert');
    const icon = type === 'success' ? '✓' : (type === 'error' ? '✕' : '•');
    t.innerHTML =
      '<div class="flex items-start gap-2 w-full">' +
        '<span class="toast-icon">' + icon + '</span>' +
        '<div class="toast-body flex-1">' +
          (title ? '<div class="font-semibold text-white mb-0.5">' + escapeHtml(title) + '</div>' : '') +
          escapeHtml(message) +
        '</div>' +
        '<button class="toast-close" aria-label="Dismiss">×</button>' +
      '</div>';
    stack.appendChild(t);
    const close = () => { t.classList.add('leaving'); setTimeout(() => t.remove(), 250); };
    t.querySelector('.toast-close').addEventListener('click', close);
    setTimeout(close, 4000);
  }

  /* =========================================================
   * Modal system (shared, with focus trap + ESC)
   * ========================================================= */
  const modalState = { open: false, onClose: null, focusables: [], lastFocus: null, escHandler: null };

  function openModal(title, bodyNode, opts = {}) {
    const root = $id('modal-root');
    const titleEl = $id('modal-title');
    const bodyEl = $id('modal-body');
    const footerEl = $id('modal-footer');
    if (!root || !bodyEl) return;
    titleEl.textContent = title;
    bodyEl.innerHTML = '';
    if (typeof bodyNode === 'string') bodyEl.innerHTML = bodyNode;
    else if (bodyNode instanceof Node) bodyEl.appendChild(bodyNode);

    footerEl.classList.add('hidden');
    footerEl.innerHTML = '';
    if (opts.footer) {
      footerEl.classList.remove('hidden');
      opts.footer.forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn ' + (b.variant || 'btn-ghost');
        btn.textContent = b.label;
        if (b.onClick) btn.addEventListener('click', () => b.onClick());
        footerEl.appendChild(btn);
      });
    }

    root.classList.remove('hidden');
    document.body.classList.add('modal-open');
    modalState.open = true;
    modalState.onClose = opts.onClose || null;
    modalState.lastFocus = document.activeElement;

    // focus trap
    setTimeout(() => {
      const f = $qsa('input, select, textarea, button, [tabindex]:not([tabindex="-1"])', bodyEl);
      const target = f.find((n) => !n.disabled);
      if (target) target.focus();
    }, 30);

    modalState.escHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      else if (e.key === 'Tab' && modalState.open) {
        // simple focus trap
        const f = $qsa('input, select, textarea, button, [tabindex]:not([tabindex="-1"])', root)
                    .filter((n) => !n.disabled && n.offsetParent !== null);
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', modalState.escHandler, true);
  }
  function closeModal() {
    const root = $id('modal-root');
    if (!root) return;
    root.classList.add('hidden');
    document.body.classList.remove('modal-open');
    modalState.open = false;
    if (modalState.escHandler) { document.removeEventListener('keydown', modalState.escHandler, true); modalState.escHandler = null; }
    if (modalState.lastFocus && modalState.lastFocus.focus) { try { modalState.lastFocus.focus(); } catch (_) {} }
    if (typeof modalState.onClose === 'function') { const cb = modalState.onClose; modalState.onClose = null; cb(); }
  }

  /* =========================================================
   * Navigation model — items change based on the mode.
   * ========================================================= */
  const NAV_CLINICAL = [
    { id: 'dashboard',      label: 'Dashboard',      icon: ICONS.dashboard },
    { id: 'alerts',         label: 'Alerts',         icon: ICONS.alerts },
    { id: 'patients',       label: 'Patients',       icon: ICONS.users },
    { id: 'consultations',  label: 'Consultations',  icon: ICONS.consults },
    { id: 'appointments',   label: 'Appointments',   icon: ICONS.calendar },
    { id: 'treatmentPlans', label: 'Treatment Plans', icon: ICONS.treatment },
    { id: 'catalogs',       label: 'Catalogs',       icon: ICONS.catalogs },
    { id: 'thresholds',     label: 'Thresholds',     icon: ICONS.thresholds },
    { id: 'workingHours',  label: 'Working Hours',   icon: ICONS.clock },
    { id: 'profile',        label: 'Profile',        icon: ICONS.user },
    { id: 'settings',       label: 'Settings',       icon: ICONS.settings },
  ];
  const NAV_TECHNICAL = [
    { id: 'tech-metrics',    label: 'Metrics',       icon: ICONS.activity },
    { id: 'tech-logs',       label: 'Request Logs',   icon: ICONS.list },
    { id: 'tech-audit',      label: 'Audit Trail',    icon: ICONS.clipboard },
    { id: 'tech-backup',     label: 'Backup',         icon: ICONS.backup },
  ];

  function currentNav() { return state.mode === 'technical' ? NAV_TECHNICAL : NAV_CLINICAL; }

  /* =========================================================
   * Sidebar rendering
   * ========================================================= */
  function renderSidebar() {
    const nav = $id('sidebar-nav');
    if (!nav) return;
    nav.innerHTML = '';
    const groupLabel = el('div', { class: 'nav-group-label' }, state.mode === 'technical' ? 'Technical' : 'Clinical');
    nav.appendChild(groupLabel);
    currentNav().forEach((item) => {
      const b = el('button', {
        type: 'button',
        class: 'nav-item' + (state.view === item.id ? ' is-active' : ''),
        'data-view': item.id,
        'aria-current': state.view === item.id ? 'page' : 'false',
      });
      b.innerHTML = svg(item.icon, 'w-4 h-4 flex-shrink-0') + '<span>' + escapeHtml(item.label) + '</span>';
      b.addEventListener('click', () => { setView(item.id); closeSidebarMobile(); });
      nav.appendChild(b);
    });
  }

  /* =========================================================
   * Header — page title + breadcrumb + notif + user chip
   * ========================================================= */
  function updatePageTitle() {
    const nav = currentNav();
    const item = nav.find((n) => n.id === state.view) || { label: 'Dashboard' };
    const titleEl = $id('page-title');
    const crumb = $id('breadcrumb');
    if (titleEl) titleEl.textContent = item.label;
    if (crumb) {
      let trail = ['Home'];
      if (state.view === 'patient-detail' && state.patientDetail.user) {
        trail.push('Patients');
        trail.push((state.patientDetail.user.name || 'Patient'));
      } else if (state.view !== 'dashboard') {
        trail.push(item.label);
      }
      crumb.innerHTML = trail.map((t, i) => {
        const last = i === trail.length - 1;
        return '<span class="' + (last ? 'text-ink-muted' : '') + '">' + escapeHtml(t) + '</span>' + (last ? '' : '<span aria-hidden="true" class="text-ink-faint">/</span>');
      }).join('');
    }
  }

  function renderUserChip() {
    const u = state.user || {};
    const name = u.name || u.phone_number || 'Doctor';
    const phone = u.phone_number || '—';
    if ($id('user-avatar')) $id('user-avatar').textContent = initials(name);
    if ($id('user-name')) $id('user-name').textContent = name;
    if ($id('user-menu-name')) $id('user-menu-name').textContent = name;
    if ($id('user-menu-phone')) $id('user-menu-phone').textContent = phone;
  }

  function updateNotifBadge() {
    const dot = $id('notif-dot');
    const cnt = $id('notif-count');
    const n = state.unreadAlerts || 0;
    if (dot) dot.classList.toggle('hidden', n === 0);
    if (cnt) {
      cnt.classList.toggle('hidden', n === 0);
      if (n > 0) cnt.textContent = n > 99 ? '99+' : String(n);
    }
  }

  /* =========================================================
   * Mode toggle
   * ========================================================= */
  function setMode(mode) {
    if (mode !== 'clinical' && mode !== 'technical') return;
    if (state.mode === mode) return;
    state.mode = mode;
    localStorage.setItem(MODE_KEY, mode);
    // Sync segmented control
    $qsa('#mode-toggle .mode-seg').forEach((b) => {
      const active = b.dataset.mode === mode;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    // Reset view to the first item of the new mode
    const firstView = (mode === 'technical' ? NAV_TECHNICAL : NAV_CLINICAL)[0].id;
    renderSidebar();
    setView(firstView);
  }

  /* =========================================================
   * View routing
   * ========================================================= */
  function setView(view) {
    if (state.view === view) {
      // already there — just re-render
    }
    state.prevView = state.view;
    state.view = view;
    // Render sidebar active state
    $qsa('#sidebar-nav .nav-item').forEach((b) => {
      const active = b.dataset.view === view;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-current', active ? 'page' : 'false');
    });
    updatePageTitle();
    const main = $id('main-content');
    if (!main) return;
    main.innerHTML = '';
    main.scrollTop = 0;

    // Dispatch to the right renderer.
    switch (view) {
      case 'dashboard':        renderDashboardView(main); break;
      case 'alerts':           renderAlertsView(main); break;
      case 'patients':         renderPatientsView(main); break;
      case 'patient-detail':   renderPatientDetailView(main); break;
      case 'consultations':    renderConsultationsView(main); break;
      case 'appointments':     renderAppointmentsView(main); break;
      case 'treatmentPlans':   renderTreatmentPlansView(main); break;
      case 'catalogs':         renderCatalogsView(main); break;
      case 'thresholds':       renderThresholdsView(main); break;
      case 'workingHours':     renderWorkingHoursView(main); break;
      case 'profile':          renderProfileView(main); break;
      case 'settings':         renderSettingsView(main); break;
      case 'tech-metrics':    renderTechMetricsView(main); break;
      case 'tech-logs':       renderTechLogsView(main); break;
      case 'tech-audit':      renderTechAuditView(main); break;
      case 'tech-backup':     renderTechBackupView(main); break;
      default:                  main.innerHTML = '<p class="text-ink-muted">Unknown view.</p>';
    }
  }

  /* =========================================================
   * Skeleton helper (rows of a table while loading)
   * ========================================================= */
  function skeletonRows(cols, rows = 4) {
    let html = '';
    for (let i = 0; i < rows; i++) {
      html += '<tr class="row-skeleton">';
      for (let j = 0; j < cols; j++) {
        html += '<td><div class="skeleton h-3 w-full" style="max-width:' + (j === 0 ? 140 : 80 + (j * 12)) + 'px"></div></td>';
      }
      html += '</tr>';
    }
    return html;
  }
  function emptyState(message, iconMarkup) {
    iconMarkup = iconMarkup || svg(ICONS.clipboard, 'w-12 h-12 text-ink-faint');
    return '<div class="empty-state">' +
             '<div class="mb-3">' + iconMarkup + '</div>' +
             '<p class="text-sm">' + escapeHtml(message || 'Nothing to show yet.') + '</p>' +
           '</div>';
  }

  /* =========================================================
   * Pagination helper
   * ========================================================= */
  function paginationFooter(p, onPrev, onNext, opts = {}) {
    if (!p) return '';
    const total = p.total || 0;
    const page = p.page || 1;
    const limit = p.limit || opts.limit || 25;
    const from = total === 0 ? 0 : (page - 1) * limit + 1;
    const to = Math.min(page * limit, total);
    return '<div class="pagination-bar">' +
      '<p class="text-xs text-ink-faint">Showing ' + from + '–' + to + ' of ' + total + '</p>' +
      '<div class="flex items-center gap-2">' +
        '<button class="btn btn-ghost px-3 py-1.5 text-xs" data-act="prev" ' + (p.hasPrev === false ? 'disabled' : '') + '>‹ Prev</button>' +
        '<span class="text-xs text-ink-muted font-mono">p.' + page + '</span>' +
        '<button class="btn btn-ghost px-3 py-1.5 text-xs" data-act="next" ' + (p.hasNext === false ? 'disabled' : '') + '>Next ›</button>' +
      '</div>' +
    '</div>';
  }
  function bindPagination(rootSel, onPrev, onNext) {
    $qsa(rootSel + ' [data-act="prev"]').forEach((b) => b.addEventListener('click', onPrev));
    $qsa(rootSel + ' [data-act="next"]').forEach((b) => b.addEventListener('click', onNext));
  }

  /* =========================================================
   * 1. DASHBOARD VIEW (Clinical #1)
   * KPI cards + Recent Cases (5) + HTTP donut + Top endpoints
   * ========================================================= */
  async function renderDashboardView(root) {
    root.innerHTML =
      '<div class="space-y-6">' +
        // KPI row
        '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" id="kpi-row"></div>' +
        // Recent cases + chart
        '<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">' +
          '<div class="card p-5 lg:col-span-2">' +
            '<div class="flex items-center justify-between mb-3">' +
              '<h3 class="text-sm font-semibold text-white">Recent Cases</h3>' +
              '<button class="text-xs text-brand-accent hover:underline" data-act="view-all">View all →</button>' +
            '</div>' +
            '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>Patient</th><th>BP</th><th>HR</th><th>Attachments</th><th>Time</th>' +
            '</tr></thead><tbody id="recent-cases-tbody">' + skeletonRows(5, 3) + '</tbody></table></div>' +
          '</div>' +
          '<div class="card p-5">' +
            '<h3 class="text-sm font-semibold text-white mb-3">HTTP Status</h3>' +
            '<div class="relative h-44 flex items-center justify-center" id="status-donut-wrap">' +
              '<div class="skeleton h-32 w-32 rounded-full"></div>' +
            '</div>' +
            '<div class="mt-3 grid grid-cols-2 gap-2 text-xs" id="status-legend"></div>' +
          '</div>' +
        '</div>' +
        '<div class="card p-5">' +
          '<h3 class="text-sm font-semibold text-white mb-3">Top Endpoints</h3>' +
          '<div id="top-endpoints" class="space-y-2"></div>' +
        '</div>' +
      '</div>';

    $qs('[data-act="view-all"]', root).addEventListener('click', () => setView('alerts'));

    // Fetch in parallel
    Promise.allSettled([
      apiJson(API + '/admin/metrics').catch(() => null),
      apiJson(API + '/admin/recent-records?limit=5&page=1').catch(() => null),
      apiJson(API + '/admin/logs/status-breakdown').catch(() => null),
      apiJson(API + '/admin/logs/top-endpoints').catch(() => null),
    ]).then(([mRes, rcRes, sbRes, teRes]) => {
      const metrics = mRes && mRes.value && mRes.value.data ? mRes.value.data : null;
      const recent  = rcRes && rcRes.value && rcRes.value.data ? rcRes.value.data : [];
      const status  = sbRes && sbRes.value && sbRes.value.data ? sbRes.value.data : [];
      const tops    = teRes && teRes.value && teRes.value.data ? teRes.value.data : [];

      renderKPIs(metrics);
      renderDashboardRecentCases(recent);
      renderStatusDonut(status);
      renderTopEndpoints(tops);
    });
  }

  function renderKPIs(metrics) {
    const row = $id('kpi-row');
    if (!row) return;
    if (!metrics) {
      row.innerHTML =
        kpiCard('Total Users', '—', 'accent-brand', svg(ICONS.users, 'w-5 h-5')) +
        kpiCard('Patients', '—', 'accent-emerald', svg(ICONS.activity, 'w-5 h-5')) +
        kpiCard('Requests 24h', '—', 'accent-amber', svg(ICONS.refresh, 'w-5 h-5')) +
        kpiCard('DB Size', '—', 'accent-rose', svg(ICONS.database, 'w-5 h-5'));
      return;
    }
    const totalUsers = (metrics.users && metrics.users.total) || 0;
    const patients   = (metrics.users && metrics.users.patients) || (metrics.patients) || 0;
    const reqs24h    = (metrics.requests && metrics.requests.last_24h) || 0;
    const dbSize     = (metrics.database && metrics.database.size_human) || '—';
    row.innerHTML =
      kpiCard('Total Users', totalUsers.toLocaleString(), 'accent-brand', svg(ICONS.users, 'w-5 h-5')) +
      kpiCard('Patients', patients.toLocaleString(), 'accent-emerald', svg(ICONS.activity, 'w-5 h-5')) +
      kpiCard('Requests 24h', reqs24h.toLocaleString(), 'accent-amber', svg(ICONS.refresh, 'w-5 h-5')) +
      kpiCard('DB Size', dbSize, 'accent-rose', svg(ICONS.database, 'w-5 h-5'));
  }
  function kpiCard(label, value, accent, iconMarkup) {
    return '<div class="card kpi-card ' + accent + ' p-5 flex items-center gap-4">' +
      '<div class="w-10 h-10 rounded-lg bg-brand/15 text-brand-accent flex items-center justify-center flex-shrink-0">' + iconMarkup + '</div>' +
      '<div class="min-w-0">' +
        '<p class="text-xs text-ink-faint uppercase tracking-wider font-semibold">' + escapeHtml(label) + '</p>' +
        '<p class="text-2xl font-bold text-white truncate">' + escapeHtml(String(value)) + '</p>' +
      '</div>' +
    '</div>';
  }

  function renderDashboardRecentCases(rows) {
    const tbody = $id('recent-cases-tbody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">' + emptyState('No recent cases.', svg(ICONS.clipboard, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => {
      const patient = r.patient || {};
      const name = patient.name || 'Unknown';
      const bp = (r.bp_systolic || r.blood_pressure || '—') + (r.bp_diastolic ? '/' + r.bp_diastolic : '');
      const hr = r.heart_rate || '—';
      const attachCount = Array.isArray(r.attachments) ? r.attachments.length : 0;
      const t = relativeTime(r.created_at);
      const userId = patient.user_id || r.patient_id || r.user_id;
      return '<tr class="recent-slim-row" data-user-id="' + escapeHtml(String(userId)) + '">' +
        '<td><div class="flex items-center gap-2">' +
          '<span class="avatar-initials" style="width:1.5rem;height:1.5rem;font-size:0.625rem">' + escapeHtml(initials(name)) + '</span>' +
          '<span class="font-medium text-white">' + escapeHtml(name) + '</span>' +
        '</div></td>' +
        '<td class="font-mono text-ink-text">' + escapeHtml(String(bp)) + '</td>' +
        '<td class="font-mono text-ink-text">' + escapeHtml(String(hr)) + '</td>' +
        '<td><span class="badge ' + (attachCount ? 'badge-info' : 'badge-slate') + '">' + attachCount + ' file' + (attachCount === 1 ? '' : 's') + '</span></td>' +
        '<td class="text-ink-muted text-xs">' + escapeHtml(t) + '</td>' +
      '</tr>';
    }).join('');
    $qsa('#recent-cases-tbody tr[data-user-id]').forEach((tr) => {
      tr.addEventListener('click', () => openPatientDetail(tr.dataset.userId));
    });
  }

  function renderStatusDonut(rows) {
    const wrap = $id('status-donut-wrap');
    if (!wrap) return;
    const canvas = el('canvas', { id: 'status-canvas', width: 200, height: 180 });
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
    state.charts.statusData = rows || [];
    const buckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    (rows || []).forEach((r) => {
      const code = (r.status_class || r._id || r.class || '').toString();
      if (buckets[code] !== undefined) buckets[code] += Number(r.count || r.c || 0);
    });
    const data = [buckets['2xx'], buckets['3xx'], buckets['4xx'], buckets['5xx']];
    const labels = ['2xx Success', '3xx Redirect', '4xx Client Err', '5xx Server Err'];
    const colors = ['#34D399', '#60A5FA', '#FBBF24', '#FB7185'];
    const total = data.reduce((a, b) => a + b, 0);
    if (state.charts.statusDonut) { try { state.charts.statusDonut.destroy(); } catch (_) {} state.charts.statusDonut = null; }
    if (typeof Chart === 'undefined') return;
    state.charts.statusDonut = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#161C28', borderWidth: 2, hoverOffset: 6 }] },
      options: {
        cutout: '68%',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#080E1A', titleColor: '#E5E9F0', bodyColor: '#94A3B8', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
            callbacks: { label: (c) => ' ' + c.label + ': ' + c.parsed + ' (' + (total ? Math.round((c.parsed / total) * 100) : 0) + '%)' }
          }
        }
      }
    });
    const legend = $id('status-legend');
    if (legend) {
      legend.innerHTML = labels.map((l, i) =>
        '<div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full" style="background:' + colors[i] + '"></span><span class="text-ink-muted">' + l + '</span><span class="font-mono text-white">' + data[i] + '</span></div>'
      ).join('');
    }
  }

  function renderTopEndpoints(rows) {
    const wrap = $id('top-endpoints');
    if (!wrap) return;
    if (!rows || rows.length === 0) {
      wrap.innerHTML = emptyState('No endpoint traffic recorded yet.', svg(ICONS.list, 'w-8 h-8 text-ink-faint'));
      return;
    }
    const max = Math.max.apply(null, rows.map((r) => Number(r.count || r.c || 0)).concat([1]));
    wrap.innerHTML = rows.slice(0, 8).map((r) => {
      const path = r.path || r._id || r.endpoint || '—';
      const count = Number(r.count || r.c || 0);
      const pct = Math.max(4, Math.round((count / max) * 100));
      const method = (r.method || 'GET').toString().toUpperCase();
      return '<div class="top-list-item">' +
        '<span class="method-badge method-' + method + '">' + escapeHtml(method) + '</span>' +
        '<span class="font-mono text-xs text-ink-text truncate flex-1">' + escapeHtml(path) + '</span>' +
        '<div class="endpoint-bar-track w-28"><div class="endpoint-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="font-mono text-xs text-ink-muted w-10 text-right">' + count + '</span>' +
      '</div>';
    }).join('');
  }

  /* =========================================================
   * 2. ALERTS VIEW
   * Table + filters (severity + status) + mark read / resolve
   * ========================================================= */
  async function renderAlertsView(root) {
    state.alerts = Object.assign({}, state.alerts, { data: [], loading: true, page: 1, pagination: null });
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="card p-4 flex flex-wrap gap-3 items-center">' +
          '<h3 class="text-sm font-semibold text-white mr-2">Alerts</h3>' +
          '<div class="flex items-center gap-1">' +
            '<label class="text-xs text-ink-faint">Severity</label>' +
            '<select id="alerts-severity" class="select text-xs py-1.5 ml-1">' +
              '<option value="">All</option>' +
              '<option value="critical">Critical</option>' +
              '<option value="warning">Warning</option>' +
            '</select>' +
          '</div>' +
          '<div class="flex items-center gap-1">' +
            '<label class="text-xs text-ink-faint">Status</label>' +
            '<select id="alerts-status" class="select text-xs py-1.5 ml-1">' +
              '<option value="unread">Unread</option>' +
              '<option value="">All</option>' +
              '<option value="read">Read</option>' +
              '<option value="resolved">Resolved</option>' +
            '</select>' +
          '</div>' +
          '<button class="btn btn-ghost text-xs px-3 py-1.5 ml-auto" data-act="refresh">' + svg(ICONS.refresh, 'w-3.5 h-3.5') + ' Refresh</button>' +
        '</div>' +
        '<div class="card p-0 overflow-hidden">' +
          '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Patient</th><th>Parameter</th><th>Value</th><th>Threshold</th><th>Severity</th><th>Status</th><th>Created</th><th>Actions</th>' +
          '</tr></thead><tbody id="alerts-tbody">' + skeletonRows(8, 4) + '</tbody></table></div>' +
          '<div class="p-3" id="alerts-pagination"></div>' +
        '</div>' +
      '</div>';

    $qs('#alerts-severity', root).value = state.alerts.severity || '';
    $qs('#alerts-status', root).value = state.alerts.status || 'unread';
    $qs('#alerts-severity', root).addEventListener('change', (e) => { state.alerts.severity = e.target.value; state.alerts.page = 1; loadAlerts(); });
    $qs('#alerts-status', root).addEventListener('change', (e) => { state.alerts.status = e.target.value; state.alerts.page = 1; loadAlerts(); });
    $qs('[data-act="refresh"]', root).addEventListener('click', () => loadAlerts());
    loadAlerts();
  }
  async function loadAlerts() {
    const tbody = $id('alerts-tbody');
    if (!tbody) return;
    if (state.alerts.loading) return;
    state.alerts.loading = true;
    tbody.innerHTML = skeletonRows(8, 4);
    const q = new URLSearchParams();
    q.set('page', state.alerts.page);
    q.set('limit', state.alerts.limit);
    if (state.alerts.severity) q.set('severity', state.alerts.severity);
    if (state.alerts.status) q.set('status', state.alerts.status);
    try {
      const body = await apiJson(API + '/admin/alerts?' + q.toString());
      const data = (body && body.data) || [];
      const pagination = body && body.pagination ? body.pagination : null;
      state.alerts.data = data;
      state.alerts.pagination = pagination;
      renderAlertsTable(data, pagination);
    } catch (err) {
      if (err && err.auth) return;
      tbody.innerHTML = '<tr><td colspan="8">' + emptyState('Failed to load alerts: ' + escapeHtml(err.message), svg(ICONS.alerts, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } finally {
      state.alerts.loading = false;
    }
  }
  function renderAlertsTable(rows, pagination) {
    const tbody = $id('alerts-tbody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8">' + emptyState('No alerts match your filters.', svg(ICONS.bell, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } else {
      tbody.innerHTML = rows.map((a) => {
        const patientName = a.patient_name || (a.patient && a.patient.name) || 'Unknown';
        const sev = (a.severity || 'warning').toString().toLowerCase();
        const sevBadge = sev === 'critical' ? '<span class="badge badge-critical"><span class="sev-dot sev-dot-critical"></span>Critical</span>'
                                            : '<span class="badge badge-warning"><span class="sev-dot sev-dot-warning"></span>Warning</span>';
        const st = (a.status || 'unread').toString().toLowerCase();
        const stBadge = st === 'unread' ? '<span class="badge badge-pending">Unread</span>'
                       : st === 'read' ? '<span class="badge badge-info">Read</span>'
                       : '<span class="badge badge-emerald">Resolved</span>';
        const actions = st === 'resolved' ? '<span class="text-xs text-ink-faint">—</span>'
          : '<div class="flex gap-1">' +
              (st === 'unread' ? '<button class="btn btn-ghost px-2 py-1 text-xs" data-act="read" data-id="' + a.id + '">Mark read</button>' : '') +
              '<button class="btn btn-success px-2 py-1 text-xs" data-act="resolve" data-id="' + a.id + '">Resolve</button>' +
            '</div>';
        return '<tr>' +
          '<td><div class="flex items-center gap-2"><span class="avatar-initials" style="width:1.5rem;height:1.5rem;font-size:0.625rem">' + escapeHtml(initials(patientName)) + '</span>' + escapeHtml(patientName) + '</div></td>' +
          '<td class="font-mono text-xs">' + escapeHtml(a.parameter_name || '—') + '</td>' +
          '<td class="font-mono text-xs text-white">' + escapeHtml(String(a.value || '—')) + '</td>' +
          '<td class="font-mono text-xs text-ink-muted">' + (a.threshold_value !== null && a.threshold_value !== undefined ? escapeHtml(String(a.threshold_value)) : '—') + '</td>' +
          '<td>' + sevBadge + '</td>' +
          '<td>' + stBadge + '</td>' +
          '<td class="text-xs text-ink-muted">' + escapeHtml(relativeTime(a.created_at)) + '</td>' +
          '<td>' + actions + '</td>' +
        '</tr>';
      }).join('');
      $qsa('#alerts-tbody [data-act="read"]').forEach((b) => b.addEventListener('click', () => alertAction(b.dataset.id, 'read')));
      $qsa('#alerts-tbody [data-act="resolve"]').forEach((b) => b.addEventListener('click', () => alertAction(b.dataset.id, 'resolve')));
    }
    const p = $id('alerts-pagination');
    if (p) {
      p.innerHTML = paginationFooter(pagination, () => { state.alerts.page--; loadAlerts(); }, () => { state.alerts.page++; loadAlerts(); }, { limit: state.alerts.limit });
      bindPagination('#alerts-pagination', () => { state.alerts.page--; loadAlerts(); }, () => { state.alerts.page++; loadAlerts(); });
    }
  }
  async function alertAction(id, action) {
    try {
      await apiJson(API + '/admin/alerts/' + encodeURIComponent(id) + '/' + (action === 'resolve' ? 'resolve' : 'read'), { method: 'PATCH' });
      toast('Alert ' + (action === 'resolve' ? 'resolved' : 'marked read') + '.', 'success');
      loadAlerts();
      pollAlerts();
    } catch (err) {
      if (err && err.auth) return;
      toast('Failed: ' + err.message, 'error');
    }
  }

  /* =========================================================
   * 3. PATIENTS VIEW (list)
   * Searchable paginated table + click row → open detail
   * ========================================================= */
  async function renderPatientsView(root) {
    state.patients = Object.assign({}, state.patients, { loading: true });
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="card p-4 flex flex-wrap gap-3 items-center">' +
          '<div class="relative flex-1 min-w-[220px]">' +
            svg(ICONS.search, 'w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none') +
            '<input id="patients-search" type="search" placeholder="Search by name or phone…" class="input pl-9 text-sm" />' +
          '</div>' +
          '<div class="text-xs text-ink-faint">Page ' + state.patients.page + '</div>' +
          '<button class="btn btn-ghost text-xs px-3 py-1.5 ml-auto" data-act="refresh">' + svg(ICONS.refresh, 'w-3.5 h-3.5') + ' Refresh</button>' +
        '</div>' +
        '<div class="card p-0 overflow-hidden">' +
          '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Patient</th><th>Phone</th><th>Status</th><th>Age</th><th>Created</th><th></th>' +
          '</tr></thead><tbody id="patients-tbody">' + skeletonRows(6, 5) + '</tbody></table></div>' +
          '<div class="p-3" id="patients-pagination"></div>' +
        '</div>' +
      '</div>';
    const searchInput = $qs('#patients-search', root);
    searchInput.value = state.patients.search || '';
    const debounced = debounce(() => { state.patients.page = 1; loadPatients(); }, SEARCH_DEBOUNCE_MS);
    searchInput.addEventListener('input', (e) => { state.patients.search = e.target.value.trim(); debounced(); });
    $qs('[data-act="refresh"]', root).addEventListener('click', () => loadPatients());
    loadPatients();
  }
  async function loadPatients() {
    const tbody = $id('patients-tbody');
    if (!tbody) return;
    state.patients.loading = true;
    tbody.innerHTML = skeletonRows(6, 5);
    const q = new URLSearchParams();
    q.set('page', state.patients.page);
    q.set('limit', state.patients.limit);
    if (state.patients.search) q.set('search', state.patients.search);
    try {
      const body = await apiJson(API + '/admin/patients?' + q.toString());
      const data = (body && body.data) || [];
      const pagination = body && body.pagination ? body.pagination : null;
      state.patients.data = data;
      state.patients.pagination = pagination;
      renderPatientsTable(data, pagination);
    } catch (err) {
      if (err && err.auth) return;
      tbody.innerHTML = '<tr><td colspan="6">' + emptyState('Failed to load patients: ' + escapeHtml(err.message), svg(ICONS.users, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } finally {
      state.patients.loading = false;
    }
  }
  function renderPatientsTable(rows, pagination) {
    const tbody = $id('patients-tbody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">' + emptyState('No patients found.', svg(ICONS.users, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } else {
      tbody.innerHTML = rows.map((p) => {
        const name = p.name || 'Unknown';
        const phone = p.phone_number || '—';
        const status = (p.status || 'active').toString().toLowerCase();
        const statusBadge = status === 'suspended' ? '<span class="badge badge-suspended">Suspended</span>' : '<span class="badge badge-active">Active</span>';
        const age = ageFromBirth(p.birth_date);
        const ageStr = age !== null ? age : '—';
        const created = relativeTime(p.created_at);
        const userId = p.user_id || p.id;
        return '<tr class="row-clickable" data-user-id="' + escapeHtml(String(userId)) + '">' +
          '<td><div class="flex items-center gap-2">' +
            '<span class="avatar-initials">' + escapeHtml(initials(name)) + '</span>' +
            '<div class="min-w-0"><div class="font-medium text-white truncate">' + escapeHtml(name) + '</div>' +
            '<div class="text-[10px] text-ink-faint font-mono">#' + escapeHtml(String(userId)) + '</div></div>' +
          '</div></td>' +
          '<td class="font-mono text-xs">' + escapeHtml(phone) + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td class="text-white">' + escapeHtml(String(ageStr)) + '</td>' +
          '<td class="text-xs text-ink-muted">' + escapeHtml(created) + '</td>' +
          '<td class="text-right"><button class="btn btn-ghost px-2 py-1 text-xs" data-act="open" data-id="' + userId + '">' + svg(ICONS.eye, 'w-3.5 h-3.5') + ' View</button></td>' +
        '</tr>';
      }).join('');
      $qsa('#patients-tbody tr[data-user-id]').forEach((tr) => {
        tr.addEventListener('click', () => openPatientDetail(tr.dataset.userId));
      });
      $qsa('#patients-tbody [data-act="open"]').forEach((b) => {
        b.addEventListener('click', (e) => { e.stopPropagation(); openPatientDetail(b.dataset.id); });
      });
    }
    const p = $id('patients-pagination');
    if (p) {
      p.innerHTML = paginationFooter(pagination, () => { state.patients.page--; loadPatients(); }, () => { state.patients.page++; loadPatients(); }, { limit: state.patients.limit });
      bindPagination('#patients-pagination', () => { state.patients.page--; loadPatients(); }, () => { state.patients.page++; loadPatients(); });
    }
  }
  function openPatientDetail(userId) {
    state.patientDetail = { userId: userId, user: null, summary: null, activeTab: 'records', records: [], recordsPage: 1, recordsLimit: 10, recordsPagination: null, documents: [], consultations: [], appointments: [], treatmentPlan: null, treatmentVersions: [], loading: true };
    setView('patient-detail');
    loadPatientDetail();
  }

  /* =========================================================
   * 3b. PATIENT DETAIL VIEW (full main-content, NOT modal)
   * ========================================================= */
  async function renderPatientDetailView(root) {
    const pd = state.patientDetail;
    if (!pd.userId) { setView('patients'); return; }
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="flex items-center justify-between">' +
          '<button class="btn btn-ghost text-xs px-3 py-1.5" id="pd-back">' + svg(ICONS.backArrow, 'w-3.5 h-3.5') + ' Back to Patients</button>' +
        '</div>' +
        '<div id="pd-header" class="card p-5"></div>' +
        '<div id="pd-status" class="card p-5"></div>' +
        '<div class="card p-5">' +
          '<div class="detail-tab-strip" id="pd-tabs"></div>' +
          '<div id="pd-tab-body"></div>' +
        '</div>' +
      '</div>';
    $qs('#pd-back', root).addEventListener('click', () => setView('patients'));
    renderPatientDetailSkeleton();
    renderPatientTabs();
  }
  function renderPatientDetailSkeleton() {
    const header = $id('pd-header');
    const status = $id('pd-status');
    const tabs = $id('pd-tabs');
    const body = $id('pd-tab-body');
    if (header) header.innerHTML = '<div class="flex items-center gap-3"><div class="skeleton w-12 h-12 rounded-full"></div><div class="space-y-2"><div class="skeleton h-4 w-40"></div><div class="skeleton h-3 w-24"></div></div></div>';
    if (status) status.innerHTML = '<div class="grid grid-cols-2 md:grid-cols-5 gap-3">' + Array(5).fill('<div class="medical-tile tile-empty"><div class="skeleton h-3 w-16"></div><div class="skeleton h-6 w-12 mt-1"></div></div>').join('') + '</div>';
    if (tabs) tabs.innerHTML = ['Records','Documents','Consultations','Appointments','Treatment Plan'].map((t,i) =>
      '<button class="tab-item' + (i === 0 ? ' is-active' : '') + '" data-tab="' + t.toLowerCase().replace(/\s+/g,'_') + '">' + t + '</button>'
    ).join('');
    if (body) body.innerHTML = '<div class="space-y-2">' + Array(3).fill('<div class="skeleton h-16 w-full"></div>').join('') + '</div>';
  }
  async function loadPatientDetail() {
    const pd = state.patientDetail;
    if (!pd.userId) return;
    const [userRes, sumRes, recRes] = await Promise.allSettled([
      apiJson(API + '/admin/patients/' + encodeURIComponent(pd.userId)).catch(() => null),
      apiJson(API + '/admin/patients/' + encodeURIComponent(pd.userId) + '/summary').catch(() => null),
      apiJson(API + '/admin/patients/' + encodeURIComponent(pd.userId) + '/records?page=1&limit=' + pd.recordsLimit).catch(() => null),
    ]);
    pd.user = userRes && userRes.value && userRes.value.data ? userRes.value.data : null;
    pd.summary = sumRes && sumRes.value && sumRes.value.data ? sumRes.value.data : null;
    const recBody = recRes && recRes.value && recRes.value.data ? recRes.value.data : {};
    pd.records = Array.isArray(recBody) ? recBody : (recBody.records || []);
    pd.recordsPagination = recRes && recRes.value && recRes.value.pagination ? recRes.value.pagination : null;
    pd.loading = false;
    renderPatientHeader();
    renderPatientStatus();
    renderPatientTabBody();
    updatePageTitle();
  }
  function renderPatientHeader() {
    const root = $id('pd-header');
    if (!root) return;
    const u = state.patientDetail.user || {};
    const name = u.name || 'Unknown';
    const phone = u.phone_number || '—';
    const status = (u.status || 'active').toString().toLowerCase();
    const statusBadge = status === 'suspended' ? '<span class="badge badge-suspended">Suspended</span>' : '<span class="badge badge-active">Active</span>';
    const age = ageFromBirth(u.birth_date);
    const smoking = u.smoking_status ? u.smoking_status.charAt(0).toUpperCase() + u.smoking_status.slice(1) : '—';
    const additionalInfo = u.additional_info || '';
    const profile = u.profile || u;
    const diseases = Array.isArray(profile.diseases) ? profile.diseases : (Array.isArray(u.diseases) ? u.diseases : []);
    const surgeries = Array.isArray(profile.surgeries) ? profile.surgeries : (Array.isArray(u.surgeries) ? u.surgeries : []);
    const medications = Array.isArray(profile.medications) ? profile.medications : (Array.isArray(u.medications) ? u.medications : []);
    root.innerHTML =
      '<div class="flex flex-wrap items-start gap-4">' +
        '<div class="avatar-initials" style="width:3rem;height:3rem;font-size:1rem">' + escapeHtml(initials(name)) + '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<h2 class="text-lg font-bold text-white">' + escapeHtml(name) + '</h2>' +
            statusBadge +
          '</div>' +
          '<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">' +
            '<span class="inline-flex items-center gap-1">' + svg(ICONS.phone, 'w-3.5 h-3.5') + escapeHtml(phone) + '</span>' +
            '<span>Age: <span class="text-white font-medium">' + escapeHtml(age !== null ? String(age) : '—') + '</span></span>' +
            '<span>Smoking: <span class="text-white font-medium capitalize">' + escapeHtml(smoking) + '</span></span>' +
            '<span class="font-mono">#' + escapeHtml(String(u.user_id || u.id || '—')) + '</span>' +
          '</div>' +
          (additionalInfo ? '<p class="mt-2 text-xs text-ink-text bg-ink-field border border-white/8 rounded-md p-2">' + escapeHtml(additionalInfo) + '</p>' : '') +
          '<div class="mt-3 grid sm:grid-cols-3 gap-3">' +
            selectionCard('Diseases', diseases, svg(ICONS.activity, 'w-4 h-4 text-rose-400')) +
            selectionCard('Surgeries', surgeries, svg(ICONS.clipboard, 'w-4 h-4 text-amber-400')) +
            selectionCard('Medications', medications, svg(ICONS.pill, 'w-4 h-4 text-emerald-400')) +
          '</div>' +
        '</div>' +
      '</div>';
  }
  function selectionCard(label, items, iconMarkup) {
    const list = (items || []).map((it) => {
      const name = it.custom_name || it.name || (it.disease && (it.disease.name)) || (it.medication && (it.medication.brand_name || it.medication.generic_name)) || (it.surgery && it.surgery.name) || '—';
      const dose = it.dose ? ' · ' + it.dose : '';
      const freq = it.frequency ? ' · ' + it.frequency : '';
      return '<li class="text-xs text-ink-text">' + escapeHtml(name) + '<span class="text-ink-faint">' + escapeHtml(dose + freq) + '</span></li>';
    }).join('');
    return '<div class="bg-ink-field border border-white/8 rounded-lg p-3">' +
      '<div class="flex items-center gap-1.5 mb-1.5 text-[10px] uppercase tracking-wider text-ink-faint font-semibold">' + iconMarkup + ' ' + escapeHtml(label) + '</div>' +
      (list ? '<ul class="space-y-1">' + list + '</ul>' : '<p class="text-xs text-ink-faint">None recorded</p>') +
    '</div>';
  }
  function renderPatientStatus() {
    const root = $id('pd-status');
    if (!root) return;
    const s = state.patientDetail.summary || {};
    const latest = s.latest_record || null;
    const trends = s.trends || {};
    const bpTrend = (trends.blood_pressure || trends.bp || 'unknown');
    const hrTrend = (trends.heart_rate || trends.hr || 'unknown');
    const totalRecords = s.total_records || 0;
    const totalCons = s.total_consultations || 0;
    const lastCons = s.last_consultation || null;
    const bpStr = latest ? (latest.bp_systolic || '—') + '/' + (latest.bp_diastolic || '—') : '—';
    const hrStr = latest ? (latest.heart_rate || '—') : '—';
    root.innerHTML =
      '<div class="flex items-center justify-between mb-3">' +
        '<h3 class="text-sm font-semibold text-white">Medical Status</h3>' +
        '<span class="text-xs text-ink-faint">' + (latest ? 'Last updated ' + escapeHtml(relativeTime(latest.created_at)) : 'No readings yet') + '</span>' +
      '</div>' +
      '<div class="grid grid-cols-2 md:grid-cols-5 gap-3">' +
        statusTile('Last BP', bpStr, trendArrow(bpTrend)) +
        statusTile('Heart Rate', hrStr, trendArrow(hrTrend)) +
        statusTile('Total Records', String(totalRecords), '') +
        statusTile('Total Consultations', String(totalCons), '') +
        (lastCons
          ? statusTile('Last Consultation', '<span class="badge ' + (lastCons.status === 'pending' ? 'badge-pending' : (lastCons.status === 'responded' ? 'badge-responded' : 'badge-slate')) + '">' + escapeHtml(lastCons.status || '—') + '</span>', relativeTime(lastCons.created_at))
          : statusTile('Last Consultation', 'None', '', true)) +
      '</div>';
  }
  function statusTile(label, value, sub, empty) {
    return '<div class="medical-tile' + (empty ? ' tile-empty' : '') + '">' +
      '<div class="tile-label">' + escapeHtml(label) + '</div>' +
      '<div class="tile-value">' + value + '</div>' +
      (sub ? '<div class="tile-sub">' + sub + '</div>' : '') +
    '</div>';
  }
  function trendArrow(trend) {
    const t = (trend || 'unknown').toString().toLowerCase();
    if (t === 'elevated') return '<span class="trend-elevated">▲</span>';
    if (t === 'lower')    return '<span class="trend-lower">▼</span>';
    if (t === 'stable')   return '<span class="trend-stable">▬</span>';
    return '<span class="trend-unknown">?</span>';
  }
  function renderPatientTabs() {
    const tabs = $id('pd-tabs');
    if (!tabs) return;
    const items = [
      { id: 'records', label: 'Records' },
      { id: 'documents', label: 'Documents' },
      { id: 'consultations', label: 'Consultations' },
      { id: 'appointments', label: 'Appointments' },
      { id: 'treatment_plan', label: 'Treatment Plan' },
    ];
    tabs.innerHTML = items.map((t) =>
      '<button class="tab-item' + (state.patientDetail.activeTab === t.id ? ' is-active' : '') + '" data-tab="' + t.id + '">' + escapeHtml(t.label) + '</button>'
    ).join('');
    $qsa('#pd-tabs .tab-item').forEach((b) => {
      b.addEventListener('click', () => {
        state.patientDetail.activeTab = b.dataset.tab;
        $qsa('#pd-tabs .tab-item').forEach((x) => x.classList.toggle('is-active', x.dataset.tab === b.dataset.tab));
        renderPatientTabBody();
        // Lazy-load tab data when first opened
        if (b.dataset.tab === 'documents' && !state.patientDetail.documents.length) loadPatientTabDocuments();
        if (b.dataset.tab === 'consultations' && !state.patientDetail.consultations.length) loadPatientTabConsultations();
        if (b.dataset.tab === 'appointments' && !state.patientDetail.appointments.length) loadPatientTabAppointments();
        if (b.dataset.tab === 'treatment_plan' && !state.patientDetail.treatmentPlan) loadPatientTabTreatmentPlan();
      });
    });
  }
  function renderPatientTabBody() {
    const body = $id('pd-tab-body');
    if (!body) return;
    const tab = state.patientDetail.activeTab;
    if (tab === 'records') renderPatientRecordsTab(body);
    else if (tab === 'documents') renderPatientDocumentsTab(body);
    else if (tab === 'consultations') renderPatientConsultationsTab(body);
    else if (tab === 'appointments') renderPatientAppointmentsTab(body);
    else if (tab === 'treatment_plan') renderPatientTreatmentPlanTab(body);
  }
  function renderPatientRecordsTab(body) {
    const records = state.patientDetail.records || [];
    if (!records.length) { body.innerHTML = emptyState('No health records yet for this patient.', svg(ICONS.activity, 'w-8 h-8 text-ink-faint')); return; }
    body.innerHTML = '<div class="space-y-3">' + records.map((r) => {
      const bp = (r.bp_systolic || '—') + '/' + (r.bp_diastolic || '—');
      const hr = r.heart_rate || '—';
      const meds = r.current_medications || '';
      const notes = r.notes || '';
      const attaches = Array.isArray(r.attachments) ? r.attachments : [];
      const attachNames = attaches.map((a) => a.file_name || a.name || a.original_name || 'file').join(', ');
      return '<div class="bg-ink-field border border-white/8 rounded-lg p-4">' +
        '<div class="flex items-center justify-between flex-wrap gap-2 mb-2">' +
          '<div class="text-xs text-ink-faint">' + escapeHtml(fmtDateTime(r.created_at)) + ' · ' + escapeHtml(relativeTime(r.created_at)) + '</div>' +
          '<span class="badge ' + (attaches.length ? 'badge-info' : 'badge-slate') + '">' + attaches.length + ' attachment' + (attaches.length === 1 ? '' : 's') + '</span>' +
        '</div>' +
        '<div class="grid grid-cols-3 gap-3 mb-2">' +
          '<div><div class="text-[10px] text-ink-faint uppercase">BP</div><div class="font-mono text-white">' + escapeHtml(String(bp)) + '</div></div>' +
          '<div><div class="text-[10px] text-ink-faint uppercase">HR</div><div class="font-mono text-white">' + escapeHtml(String(hr)) + '</div></div>' +
          '<div><div class="text-[10px] text-ink-faint uppercase">Meds</div><div class="text-xs text-ink-text truncate">' + escapeHtml(meds || '—') + '</div></div>' +
        '</div>' +
        (notes ? '<div class="text-xs text-ink-text bg-ink-deep border border-white/5 rounded p-2 mb-2">' + escapeHtml(notes) + '</div>' : '') +
        (attachNames ? '<div class="text-[10px] text-ink-faint">📎 ' + escapeHtml(attachNames) + '</div>' : '') +
      '</div>';
    }).join('') + '</div>' +
    '<div class="pt-3">' + paginationFooter(state.patientDetail.recordsPagination,
      () => { state.patientDetail.recordsPage--; loadPatientRecordsPage(); },
      () => { state.patientDetail.recordsPage++; loadPatientRecordsPage(); },
      { limit: state.patientDetail.recordsLimit }) + '</div>';
    bindPagination('#pd-tab-body', () => { state.patientDetail.recordsPage--; loadPatientRecordsPage(); }, () => { state.patientDetail.recordsPage++; loadPatientRecordsPage(); });
  }
  async function loadPatientRecordsPage() {
    const pd = state.patientDetail;
    try {
      const body = await apiJson(API + '/admin/patients/' + encodeURIComponent(pd.userId) + '/records?page=' + pd.recordsPage + '&limit=' + pd.recordsLimit);
      const data = (body && body.data) || {};
      pd.records = Array.isArray(data) ? data : (data.records || []);
      pd.recordsPagination = body && body.pagination ? body.pagination : null;
      renderPatientTabBody();
    } catch (err) { if (err && err.auth) return; toast('Failed to load records: ' + err.message, 'error'); }
  }
  function renderPatientDocumentsTab(body) {
    const docs = state.patientDetail.documents || [];
    if (docs === null || docs.length === 0) { body.innerHTML = emptyState('No documents yet.', svg(ICONS.file, 'w-8 h-8 text-ink-faint')); return; }
    body.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Type</th><th>Title</th><th>Date</th><th>Notes</th></tr></thead><tbody>' +
      docs.map((d) => '<tr>' +
        '<td><span class="badge badge-info">' + escapeHtml((d.type || 'other').toUpperCase()) + '</span></td>' +
        '<td class="text-white">' + escapeHtml(d.title || '—') + '</td>' +
        '<td class="text-xs">' + escapeHtml(fmtDate(d.taken_at || d.created_at)) + '</td>' +
        '<td class="text-xs text-ink-muted truncate max-w-[260px]">' + escapeHtml(d.notes || '—') + '</td>' +
      '</tr>').join('') + '</tbody></table></div>';
  }
  async function loadPatientTabDocuments() {
    try {
      const body = await apiJson(API + '/admin/patients/' + encodeURIComponent(state.patientDetail.userId) + '/documents');
      state.patientDetail.documents = (body && body.data) || [];
      renderPatientTabBody();
    } catch (err) { if (err && err.auth) return; toast('Failed to load documents: ' + err.message, 'error'); }
  }
  function renderPatientConsultationsTab(body) {
    const list = state.patientDetail.consultations || [];
    if (!list.length) { body.innerHTML = emptyState('No consultations recorded.', svg(ICONS.consults, 'w-8 h-8 text-ink-faint')); return; }
    body.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Category</th><th>Type</th><th>Reason</th><th>Status</th><th>Created</th></tr></thead><tbody>' +
      list.map((c) => {
        const cat = (c.category || 'regular').toString().toLowerCase();
        const catBadge = cat === 'immediate' ? '<span class="badge badge-immediate">Immediate</span>' : '<span class="badge badge-regular">Regular</span>';
        const st = (c.status || 'pending').toString().toLowerCase();
        const stBadge = st === 'responded' ? '<span class="badge badge-responded">Responded</span>' : st === 'closed' ? '<span class="badge badge-closed">Closed</span>' : '<span class="badge badge-pending">Pending</span>';
        const typ = c.custom_type || (c.type && (c.type.name)) || '—';
        return '<tr>' +
          '<td>' + catBadge + '</td>' +
          '<td class="text-white text-xs">' + escapeHtml(typ) + '</td>' +
          '<td class="text-xs text-ink-text truncate max-w-[300px]">' + escapeHtml(c.reason || '—') + '</td>' +
          '<td>' + stBadge + '</td>' +
          '<td class="text-xs text-ink-muted">' + escapeHtml(relativeTime(c.created_at)) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  async function loadPatientTabConsultations() {
    try {
      const body = await apiJson(API + '/admin/patients/' + encodeURIComponent(state.patientDetail.userId) + '/consultations');
      state.patientDetail.consultations = (body && body.data) || [];
      renderPatientTabBody();
    } catch (err) { if (err && err.auth) return; toast('Failed to load consultations: ' + err.message, 'error'); }
  }
  function renderPatientAppointmentsTab(body) {
    const list = state.patientDetail.appointments || [];
    if (!list.length) { body.innerHTML = emptyState('No appointments recorded.', svg(ICONS.calendar, 'w-8 h-8 text-ink-faint')); return; }
    body.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Time</th><th>Status</th><th>Notes</th><th>WhatsApp</th></tr></thead><tbody>' +
      list.map((a) => {
        const st = (a.status || 'requested').toString().toLowerCase();
        const stBadge = '<span class="badge badge-' + st + '">' + escapeHtml(st.charAt(0).toUpperCase() + st.slice(1)) + '</span>';
        const wa = a.whatsapp_link ? '<a href="' + escapeHtml(a.whatsapp_link) + '" target="_blank" rel="noopener" class="text-brand-accent hover:underline text-xs">Open ↗</a>' : '<span class="text-ink-faint">—</span>';
        return '<tr>' +
          '<td class="text-white">' + escapeHtml(fmtDate(a.scheduled_date)) + '</td>' +
          '<td class="font-mono text-xs">' + escapeHtml(a.scheduled_time || '—') + '</td>' +
          '<td>' + stBadge + '</td>' +
          '<td class="text-xs text-ink-muted truncate max-w-[260px]">' + escapeHtml(a.notes || '—') + '</td>' +
          '<td>' + wa + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  async function loadPatientTabAppointments() {
    try {
      const body = await apiJson(API + '/admin/patients/' + encodeURIComponent(state.patientDetail.userId) + '/appointments');
      state.patientDetail.appointments = (body && body.data) || [];
      renderPatientTabBody();
    } catch (err) { if (err && err.auth) return; toast('Failed to load appointments: ' + err.message, 'error'); }
  }
  function renderPatientTreatmentPlanTab(body) {
    const tp = state.patientDetail.treatmentPlan;
    if (!tp) { body.innerHTML = emptyState('No treatment plan yet.', svg(ICONS.treatment, 'w-8 h-8 text-ink-faint')); return; }
    body.innerHTML = '<div class="space-y-3">' +
      '<div class="bg-ink-field border border-white/8 rounded-lg p-3"><div class="text-[10px] uppercase text-ink-faint mb-1">Recommended Medications</div><pre class="json-block">' + escapeHtml(JSON.stringify(tp.recommended_medications || [], null, 2)) + '</pre></div>' +
      '<div class="bg-ink-field border border-white/8 rounded-lg p-3"><div class="text-[10px] uppercase text-ink-faint mb-1">Instructions</div><p class="text-sm text-ink-text">' + escapeHtml(tp.instructions || '—') + '</p></div>' +
      '<div class="bg-ink-field border border-white/8 rounded-lg p-3"><div class="text-[10px] uppercase text-ink-faint mb-1">Follow-up Dates</div><div class="flex flex-wrap gap-1.5">' + ((tp.follow_up_dates || []).map((d) => '<span class="badge badge-info">' + escapeHtml(fmtDate(d)) + '</span>').join('') || '<span class="text-ink-faint text-xs">—</span>') + '</div></div>' +
      '<div class="bg-ink-field border border-white/8 rounded-lg p-3"><div class="text-[10px] uppercase text-ink-faint mb-1">Clinical Notes</div><p class="text-sm text-ink-text">' + escapeHtml(tp.clinical_notes || '—') + '</p></div>' +
      '<p class="text-xs text-ink-faint">Read-only view. Edit via the Treatment Plans section.</p>' +
    '</div>';
  }
  async function loadPatientTabTreatmentPlan() {
    try {
      const body = await apiJson(API + '/admin/patients/' + encodeURIComponent(state.patientDetail.userId) + '/treatment-plan');
      state.patientDetail.treatmentPlan = (body && body.data) || null;
      renderPatientTabBody();
    } catch (err) {
      if (err && err.auth) return;
      state.patientDetail.treatmentPlan = null;
      renderPatientTabBody();
    }
  }

  /* =========================================================
   * 4. CONSULTATIONS VIEW
   * Table + filter by status + respond modal
   * ========================================================= */
  async function renderConsultationsView(root) {
    state.consultations = Object.assign({}, state.consultations, { loading: true });
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="card p-4 flex flex-wrap gap-3 items-center">' +
          '<h3 class="text-sm font-semibold text-white">Consultations</h3>' +
          '<select id="cons-status" class="select text-xs py-1.5">' +
            '<option value="pending">Pending</option>' +
            '<option value="">All</option>' +
            '<option value="responded">Responded</option>' +
            '<option value="closed">Closed</option>' +
          '</select>' +
          '<button class="btn btn-ghost text-xs px-3 py-1.5 ml-auto" data-act="refresh">' + svg(ICONS.refresh, 'w-3.5 h-3.5') + ' Refresh</button>' +
        '</div>' +
        '<div class="card p-0 overflow-hidden">' +
          '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Patient</th><th>Category</th><th>Type</th><th>Reason</th><th>Status</th><th>Created</th><th></th>' +
          '</tr></thead><tbody id="cons-tbody">' + skeletonRows(7, 4) + '</tbody></table></div>' +
          '<div class="p-3" id="cons-pagination"></div>' +
        '</div>' +
      '</div>';
    $qs('#cons-status', root).value = state.consultations.status || 'pending';
    $qs('#cons-status', root).addEventListener('change', (e) => { state.consultations.status = e.target.value; state.consultations.page = 1; loadConsultations(); });
    $qs('[data-act="refresh"]', root).addEventListener('click', () => loadConsultations());
    loadConsultations();
  }
  async function loadConsultations() {
    const tbody = $id('cons-tbody');
    if (!tbody) return;
    state.consultations.loading = true;
    tbody.innerHTML = skeletonRows(7, 4);
    const q = new URLSearchParams();
    q.set('page', state.consultations.page);
    q.set('limit', state.consultations.limit);
    if (state.consultations.status) q.set('status', state.consultations.status);
    try {
      const body = await apiJson(API + '/admin/consultations?' + q.toString());
      const data = (body && body.data) || [];
      state.consultations.data = data;
      state.consultations.pagination = body && body.pagination ? body.pagination : null;
      renderConsultationsTable(data, body && body.pagination);
    } catch (err) {
      if (err && err.auth) return;
      tbody.innerHTML = '<tr><td colspan="7">' + emptyState('Failed to load consultations: ' + escapeHtml(err.message), svg(ICONS.consults, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } finally {
      state.consultations.loading = false;
    }
  }
  function renderConsultationsTable(rows, pagination) {
    const tbody = $id('cons-tbody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">' + emptyState('No consultations match this filter.', svg(ICONS.consults, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } else {
      tbody.innerHTML = rows.map((c) => {
        const patientName = c.patient_name || (c.patient && c.patient.name) || 'Unknown';
        const cat = (c.category || 'regular').toString().toLowerCase();
        const catBadge = cat === 'immediate' ? '<span class="badge badge-immediate">Immediate</span>' : '<span class="badge badge-regular">Regular</span>';
        const st = (c.status || 'pending').toString().toLowerCase();
        const stBadge = st === 'responded' ? '<span class="badge badge-responded">Responded</span>' : st === 'closed' ? '<span class="badge badge-closed">Closed</span>' : '<span class="badge badge-pending">Pending</span>';
        const typ = c.custom_type || (c.type && c.type.name) || '—';
        const cid = c.id || c.consultation_id;
        const actionBtn = st === 'pending'
          ? '<button class="btn btn-primary px-2 py-1 text-xs" data-act="respond" data-id="' + cid + '">Respond</button>'
          : '<button class="btn btn-ghost px-2 py-1 text-xs" data-act="view" data-id="' + cid + '">View</button>';
        return '<tr>' +
          '<td><div class="flex items-center gap-2"><span class="avatar-initials" style="width:1.5rem;height:1.5rem;font-size:0.625rem">' + escapeHtml(initials(patientName)) + '</span>' + escapeHtml(patientName) + '</div></td>' +
          '<td>' + catBadge + '</td>' +
          '<td class="text-white text-xs">' + escapeHtml(typ) + '</td>' +
          '<td class="text-xs text-ink-text truncate max-w-[300px]">' + escapeHtml(c.reason || '—') + '</td>' +
          '<td>' + stBadge + '</td>' +
          '<td class="text-xs text-ink-muted">' + escapeHtml(relativeTime(c.created_at)) + '</td>' +
          '<td class="text-right">' + actionBtn + '</td>' +
        '</tr>';
      }).join('');
      $qsa('#cons-tbody [data-act="respond"]').forEach((b) => b.addEventListener('click', () => openConsultationRespond(b.dataset.id)));
      $qsa('#cons-tbody [data-act="view"]').forEach((b) => b.addEventListener('click', () => openConsultationView(b.dataset.id)));
    }
    const p = $id('cons-pagination');
    if (p) {
      p.innerHTML = paginationFooter(pagination, () => { state.consultations.page--; loadConsultations(); }, () => { state.consultations.page++; loadConsultations(); }, { limit: state.consultations.limit });
      bindPagination('#cons-pagination', () => { state.consultations.page--; loadConsultations(); }, () => { state.consultations.page++; loadConsultations(); });
    }
  }
  function findConsultation(id) {
    return state.consultations.data.find((c) => String(c.id || c.consultation_id) === String(id));
  }
  function openConsultationView(id) {
    const c = findConsultation(id);
    if (!c) { toast('Consultation not found.', 'error'); return; }
    openModal('Consultation #' + id, renderConsultationContext(c), { footer: [{ label: 'Close', variant: 'btn-ghost', onClick: closeModal }] });
  }
  function openConsultationRespond(id) {
    const c = findConsultation(id);
    if (!c) { toast('Consultation not found.', 'error'); return; }
    const wrap = el('div', { class: 'space-y-3' });
    wrap.innerHTML = renderConsultationContext(c);
    const form = el('form', { id: 'respond-form', class: 'space-y-3 mt-2' });
    form.innerHTML =
      '<div><label class="block text-xs text-ink-muted mb-1">Response text</label><textarea name="response_text" rows="3" class="textarea" placeholder="Your response to the patient…"></textarea></div>' +
      '<div><label class="block text-xs text-ink-muted mb-1">Recommended action</label><input name="recommended_action" type="text" class="input" placeholder="e.g. increase_concor_dose" /></div>' +
      '<div><label class="block text-xs text-ink-muted mb-1">Follow-up date</label><input name="follow_up_date" type="date" class="input" /></div>';
    wrap.appendChild(form);
    openModal('Respond to Consultation #' + id, wrap, {
      footer: [
        { label: 'Cancel', variant: 'btn-ghost', onClick: closeModal },
        { label: 'Send Response', variant: 'btn-primary', onClick: async () => {
          const fd = new FormData(form);
          const payload = {
            response_text: fd.get('response_text') || '',
            recommended_action: fd.get('recommended_action') || '',
            follow_up_date: fd.get('follow_up_date') || undefined,
          };
          try {
            await apiJson(API + '/admin/consultations/' + encodeURIComponent(id) + '/respond', { method: 'PATCH', body: payload });
            toast('Response sent.', 'success');
            closeModal();
            loadConsultations();
          } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
        } },
      ]
    });
  }
  function renderConsultationContext(c) {
    const ctx = c.context || {};
    const latest = ctx.latest_reading || null;
    const fresh = ctx.reading_freshness || 'none';
    const symptoms = ctx.latest_symptoms || null;
    let html = '<div class="space-y-2 mb-2">';
    if (latest) {
      html += '<div class="bg-ink-field border border-white/8 rounded p-2 text-xs">';
      html += '<div class="text-[10px] uppercase text-ink-faint mb-1">Latest reading</div>';
      html += '<div class="font-mono">BP ' + (latest.bp_systolic || '—') + '/' + (latest.bp_diastolic || '—') + ' · HR ' + (latest.heart_rate || '—') + '</div>';
      html += '<div class="text-ink-faint mt-0.5">Freshness: <span class="' + (fresh === 'fresh' ? 'text-emerald-400' : fresh === 'old' ? 'text-amber-400' : 'text-ink-faint') + '">' + escapeHtml(fresh) + '</span> · ' + escapeHtml(relativeTime(latest.created_at)) + '</div>';
      html += '</div>';
    } else {
      html += '<div class="bg-ink-field border border-white/8 rounded p-2 text-xs text-ink-faint">No recent reading.</div>';
    }
    if (symptoms) {
      html += '<div class="bg-ink-field border border-white/8 rounded p-2 text-xs">';
      html += '<div class="text-[10px] uppercase text-ink-faint mb-1">Latest symptoms</div>';
      const arr = Array.isArray(symptoms.symptoms) ? symptoms.symptoms : [];
      html += arr.map((s) => escapeHtml(s.custom_name || (s.symptom && s.symptom.name) || '—')).join(', ') || '<span class="text-ink-faint">none logged</span>';
      html += '</div>';
    }
    if (c.reason) {
      html += '<div class="bg-ink-field border border-white/8 rounded p-2 text-xs"><div class="text-[10px] uppercase text-ink-faint mb-1">Reason</div>' + escapeHtml(c.reason) + '</div>';
    }
    if (c.whatsapp_link) {
      html += '<a href="' + escapeHtml(c.whatsapp_link) + '" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline">' + svg(ICONS.whatsapp, 'w-3.5 h-3.5') + ' Open WhatsApp chat</a>';
    }
    html += '</div>';
    return html;
  }

  /* =========================================================
   * 5. APPOINTMENTS VIEW
   * Table + filter by status + confirm/cancel
   * ========================================================= */
  async function renderAppointmentsView(root) {
    state.appointments = Object.assign({}, state.appointments, { loading: true });
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="card p-4 flex flex-wrap gap-3 items-center">' +
          '<h3 class="text-sm font-semibold text-white">Appointments</h3>' +
          '<select id="appt-status" class="select text-xs py-1.5">' +
            '<option value="">All</option>' +
            '<option value="requested">Requested</option>' +
            '<option value="confirmed">Confirmed</option>' +
            '<option value="cancelled">Cancelled</option>' +
            '<option value="completed">Completed</option>' +
          '</select>' +
          '<button class="btn btn-ghost text-xs px-3 py-1.5 ml-auto" data-act="refresh">' + svg(ICONS.refresh, 'w-3.5 h-3.5') + ' Refresh</button>' +
        '</div>' +
        '<div class="card p-0 overflow-hidden">' +
          '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Patient</th><th>Date</th><th>Time</th><th>Status</th><th>Notes</th><th>WhatsApp</th><th>Actions</th>' +
          '</tr></thead><tbody id="appt-tbody">' + skeletonRows(7, 4) + '</tbody></table></div>' +
          '<div class="p-3" id="appt-pagination"></div>' +
        '</div>' +
      '</div>';
    $qs('#appt-status', root).value = state.appointments.status || '';
    $qs('#appt-status', root).addEventListener('change', (e) => { state.appointments.status = e.target.value; state.appointments.page = 1; loadAppointments(); });
    $qs('[data-act="refresh"]', root).addEventListener('click', () => loadAppointments());
    loadAppointments();
  }
  async function loadAppointments() {
    const tbody = $id('appt-tbody');
    if (!tbody) return;
    state.appointments.loading = true;
    tbody.innerHTML = skeletonRows(7, 4);
    const q = new URLSearchParams();
    q.set('page', state.appointments.page);
    q.set('limit', state.appointments.limit);
    if (state.appointments.status) q.set('status', state.appointments.status);
    try {
      const body = await apiJson(API + '/admin/appointments?' + q.toString());
      const data = (body && body.data) || [];
      state.appointments.data = data;
      state.appointments.pagination = body && body.pagination ? body.pagination : null;
      renderAppointmentsTable(data, body && body.pagination);
    } catch (err) {
      if (err && err.auth) return;
      tbody.innerHTML = '<tr><td colspan="7">' + emptyState('Failed to load appointments: ' + escapeHtml(err.message), svg(ICONS.calendar, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } finally {
      state.appointments.loading = false;
    }
  }
  function renderAppointmentsTable(rows, pagination) {
    const tbody = $id('appt-tbody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">' + emptyState('No appointments match this filter.', svg(ICONS.calendar, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } else {
      tbody.innerHTML = rows.map((a) => {
        const patientName = a.patient_name || (a.patient && a.patient.name) || 'Unknown';
        const st = (a.status || 'requested').toString().toLowerCase();
        const stBadge = '<span class="badge badge-' + st + '">' + escapeHtml(st.charAt(0).toUpperCase() + st.slice(1)) + '</span>';
        const wa = a.whatsapp_link ? '<a href="' + escapeHtml(a.whatsapp_link) + '" target="_blank" rel="noopener" class="text-emerald-400 hover:underline text-xs">Open ↗</a>' : '<span class="text-ink-faint">—</span>';
        const aid = a.id || a.appointment_id;
        const actions = st === 'requested'
          ? '<div class="flex gap-1"><button class="btn btn-success px-2 py-1 text-xs" data-act="confirm" data-id="' + aid + '">Confirm</button><button class="btn btn-danger px-2 py-1 text-xs" data-act="cancel" data-id="' + aid + '">Cancel</button></div>'
          : (st === 'confirmed' ? '<button class="btn btn-danger px-2 py-1 text-xs" data-act="cancel" data-id="' + aid + '">Cancel</button>' : '<span class="text-ink-faint">—</span>');
        return '<tr>' +
          '<td><div class="flex items-center gap-2"><span class="avatar-initials" style="width:1.5rem;height:1.5rem;font-size:0.625rem">' + escapeHtml(initials(patientName)) + '</span>' + escapeHtml(patientName) + '</div></td>' +
          '<td class="text-white">' + escapeHtml(fmtDate(a.scheduled_date)) + '</td>' +
          '<td class="font-mono text-xs">' + escapeHtml(a.scheduled_time || '—') + '</td>' +
          '<td>' + stBadge + '</td>' +
          '<td class="text-xs text-ink-muted truncate max-w-[220px]">' + escapeHtml(a.notes || '—') + '</td>' +
          '<td>' + wa + '</td>' +
          '<td>' + actions + '</td>' +
        '</tr>';
      }).join('');
      $qsa('#appt-tbody [data-act="confirm"]').forEach((b) => b.addEventListener('click', () => appointmentAction(b.dataset.id, 'confirm')));
      $qsa('#appt-tbody [data-act="cancel"]').forEach((b) => b.addEventListener('click', () => appointmentAction(b.dataset.id, 'cancel')));
    }
    const p = $id('appt-pagination');
    if (p) {
      p.innerHTML = paginationFooter(pagination, () => { state.appointments.page--; loadAppointments(); }, () => { state.appointments.page++; loadAppointments(); }, { limit: state.appointments.limit });
      bindPagination('#appt-pagination', () => { state.appointments.page--; loadAppointments(); }, () => { state.appointments.page++; loadAppointments(); });
    }
  }
  async function appointmentAction(id, action) {
    try {
      await apiJson(API + '/admin/appointments/' + encodeURIComponent(id) + '/' + action, { method: 'PATCH' });
      toast('Appointment ' + (action === 'confirm' ? 'confirmed — WhatsApp link generated.' : 'cancelled.'), 'success');
      loadAppointments();
    } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
  }

  /* =========================================================
   * 6. TREATMENT PLANS VIEW
   * Patient search dropdown + create/edit form + version history
   * ========================================================= */
  async function renderTreatmentPlansView(root) {
    state.treatmentPlans = Object.assign({}, state.treatmentPlans, { loading: true });
    root.innerHTML =
      '<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">' +
        // Left col: patient picker + versions
        '<div class="card p-5 space-y-4">' +
          '<h3 class="text-sm font-semibold text-white">Pick a Patient</h3>' +
          '<div class="search-dropdown">' +
            '<input id="tp-search" type="search" class="input text-sm" placeholder="Search name or phone…" />' +
            '<div id="tp-results" class="search-dropdown-results hidden"></div>' +
          '</div>' +
          '<div id="tp-selected" class="text-xs text-ink-faint">No patient selected.</div>' +
          '<div>' +
            '<h4 class="text-xs font-semibold text-white mt-4 mb-2">Version history</h4>' +
            '<div id="tp-versions" class="space-y-1.5 text-xs text-ink-muted">—</div>' +
          '</div>' +
        '</div>' +
        // Right col: form
        '<div class="card p-5 lg:col-span-2">' +
          '<div id="tp-form-wrap">' + (state.treatmentPlans.patient ? '' : emptyState('Pick a patient to load or create their treatment plan.', svg(ICONS.treatment, 'w-8 h-8 text-ink-faint'))) + '</div>' +
        '</div>' +
      '</div>';
    const search = $qs('#tp-search', root);
    const debounced = debounce(() => loadTreatmentPatientResults(search.value.trim()), SEARCH_DEBOUNCE_MS);
    search.addEventListener('input', debounced);
    search.addEventListener('focus', () => { if (state.treatmentPlans.patientResults.length) $id('tp-results').classList.remove('hidden'); });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-dropdown')) { const r = $id('tp-results'); if (r) r.classList.add('hidden'); }
    }, { once: true });
    // if a patient was previously selected, load the form
    if (state.treatmentPlans.patient) renderTreatmentPlanForm();
  }
  async function loadTreatmentPatientResults(query) {
    if (!query) { state.treatmentPlans.patientResults = []; renderTreatmentPatientResults([]); return; }
    const q = new URLSearchParams();
    q.set('page', 1); q.set('limit', 10); q.set('search', query);
    try {
      const body = await apiJson(API + '/admin/patients?' + q.toString());
      const data = (body && body.data) || [];
      state.treatmentPlans.patientResults = data;
      renderTreatmentPatientResults(data);
    } catch (_) { /* swallow */ }
  }
  function renderTreatmentPatientResults(rows) {
    const wrap = $id('tp-results');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = '<div class="search-dropdown-item text-ink-faint">No matches</div>'; wrap.classList.remove('hidden'); return; }
    wrap.innerHTML = rows.map((p) =>
      '<div class="search-dropdown-item" data-id="' + p.user_id + '"><div class="text-white">' + escapeHtml(p.name) + '</div><div class="text-ink-faint text-[10px] font-mono">' + escapeHtml(p.phone_number || '—') + '</div></div>'
    ).join('');
    wrap.classList.remove('hidden');
    $qsa('#tp-results .search-dropdown-item[data-id]').forEach((it) => {
      it.addEventListener('click', () => {
        const p = rows.find((x) => String(x.user_id) === String(it.dataset.id));
        if (!p) return;
        state.treatmentPlans.patient = p;
        $id('tp-selected').innerHTML = '<div class="flex items-center gap-2 mt-2"><span class="avatar-initials" style="width:1.5rem;height:1.5rem;font-size:0.625rem">' + escapeHtml(initials(p.name)) + '</span><div><div class="text-white text-xs font-medium">' + escapeHtml(p.name) + '</div><div class="text-ink-faint text-[10px] font-mono">' + escapeHtml(p.phone_number || '—') + '</div></div></div>';
        $id('tp-results').classList.add('hidden');
        $id('tp-search').value = '';
        loadTreatmentPlan();
      });
    });
  }
  async function loadTreatmentPlan() {
    const p = state.treatmentPlans.patient;
    if (!p) return;
    const wrap = $id('tp-form-wrap');
    if (wrap) wrap.innerHTML = '<div class="space-y-2">' + Array(3).fill('<div class="skeleton h-12 w-full"></div>').join('') + '</div>';
    try {
      const [planRes, verRes] = await Promise.allSettled([
        apiJson(API + '/admin/patients/' + encodeURIComponent(p.user_id) + '/treatment-plan').catch(() => null),
        apiJson(API + '/admin/patients/' + encodeURIComponent(p.user_id) + '/treatment-plan/versions').catch(() => null),
      ]);
      state.treatmentPlans.plan = (planRes && planRes.value && planRes.value.data) || null;
      state.treatmentPlans.versions = (verRes && verRes.value && verRes.value.data) || [];
      renderTreatmentPlanForm();
      renderTreatmentPlanVersions();
    } catch (err) { if (err && err.auth) return; toast('Failed to load plan: ' + err.message, 'error'); }
  }
  function renderTreatmentPlanVersions() {
    const wrap = $id('tp-versions');
    if (!wrap) return;
    const vers = state.treatmentPlans.versions || [];
    if (!vers.length) { wrap.innerHTML = '<p class="text-ink-faint">No versions yet.</p>'; return; }
    wrap.innerHTML = vers.slice().reverse().map((v, i) => {
      const isCurrent = i === 0;
      return '<div class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full ' + (isCurrent ? 'bg-brand-accent' : 'bg-ink-faint') + '"></span><span class="' + (isCurrent ? 'text-white font-medium' : 'text-ink-muted') + '">v' + (vers.length - i) + '</span><span class="text-ink-faint">· ' + escapeHtml(relativeTime(v.created_at || v.snapshot_at)) + '</span></div>';
    }).join('');
  }
  function renderTreatmentPlanForm() {
    const wrap = $id('tp-form-wrap');
    if (!wrap) return;
    const p = state.treatmentPlans.patient;
    if (!p) { wrap.innerHTML = emptyState('Pick a patient to load or create their treatment plan.', svg(ICONS.treatment, 'w-8 h-8 text-ink-faint')); return; }
    const tp = state.treatmentPlans.plan || {};
    const meds = tp.recommended_medications || [];
    const instr = tp.instructions || '';
    const fud = tp.follow_up_dates || [];
    const cn = tp.clinical_notes || '';
    wrap.innerHTML =
      '<form id="tp-form" class="space-y-4">' +
        '<div class="flex items-center justify-between">' +
          '<h3 class="text-sm font-semibold text-white">Treatment Plan · ' + escapeHtml(p.name) + '</h3>' +
          (state.treatmentPlans.plan ? '<span class="badge badge-info">Loaded</span>' : '<span class="badge badge-pending">New</span>') +
        '</div>' +
        '<div>' +
          '<label class="block text-xs text-ink-muted mb-1">Recommended medications (JSON array)</label>' +
          '<textarea name="medications" rows="5" class="textarea font-mono text-xs" placeholder=\'[{"medication_id": 1, "dose": "75mg", "reason": "..."}]\'>' + escapeHtml(JSON.stringify(meds, null, 2)) + '</textarea>' +
          '<p class="text-[10px] text-ink-faint mt-1">Each item: medication_id (optional) · custom_name · dose · reason</p>' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs text-ink-muted mb-1">Instructions</label>' +
          '<textarea name="instructions" rows="3" class="textarea" placeholder="Diet / exercise / lifestyle guidance…">' + escapeHtml(instr) + '</textarea>' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs text-ink-muted mb-1">Follow-up dates (one per line, ISO YYYY-MM-DD)</label>' +
          '<textarea name="follow_up_dates" rows="3" class="textarea font-mono text-xs" placeholder="2025-12-20&#10;2026-01-05">' + escapeHtml(fud.join('\n')) + '</textarea>' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs text-ink-muted mb-1">Clinical notes</label>' +
          '<textarea name="clinical_notes" rows="3" class="textarea" placeholder="Progress, observations…">' + escapeHtml(cn) + '</textarea>' +
        '</div>' +
        '<div class="flex justify-end gap-2 pt-2 border-t border-white/8">' +
          '<button type="button" class="btn btn-ghost" data-act="reset">Reset</button>' +
          '<button type="submit" class="btn btn-primary">' + svg(ICONS.check, 'w-3.5 h-3.5') + ' Save Plan</button>' +
        '</div>' +
      '</form>';
    const form = $qs('#tp-form', wrap);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      let medsParsed = [];
      try { medsParsed = JSON.parse(fd.get('medications') || '[]'); if (!Array.isArray(medsParsed)) throw new Error('not array'); }
      catch (_) { toast('Recommended medications must be a JSON array.', 'error'); return; }
      const fud = (fd.get('follow_up_dates') || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const payload = {
        recommended_medications: medsParsed,
        instructions: fd.get('instructions') || '',
        follow_up_dates: fud,
        clinical_notes: fd.get('clinical_notes') || '',
      };
      try {
        await apiJson(API + '/admin/patients/' + encodeURIComponent(p.user_id) + '/treatment-plan', { method: 'POST', body: payload });
        toast('Treatment plan saved.', 'success');
        loadTreatmentPlan();
      } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
    });
    $qs('[data-act="reset"]', wrap).addEventListener('click', () => { renderTreatmentPlanForm(); });
  }

  /* =========================================================
   * 7. CATALOGS VIEW (5 tabs)
   * ========================================================= */
  const CATALOGS = [
    { id: 'diseases',           label: 'Diseases',           columns: ['name','category'] },
    { id: 'surgeries',          label: 'Surgeries',          columns: ['name','category'] },
    { id: 'symptoms',           label: 'Symptoms',           columns: ['name','category','is_critical'] },
    { id: 'medications',        label: 'Medications',        columns: ['brand_name','generic_name','form','category'] },
    { id: 'consultation_types', label: 'Consultation Types', columns: ['name','category'] },
  ];
  async function renderCatalogsView(root) {
    state.catalogs.loading = true;
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="card p-0 overflow-hidden">' +
          '<div class="p-4 flex items-center justify-between border-b border-white/8">' +
            '<h3 class="text-sm font-semibold text-white">Catalogs</h3>' +
            '<button class="btn btn-primary text-xs px-3 py-1.5" data-act="add">' + svg(ICONS.plus, 'w-3.5 h-3.5') + ' Add</button>' +
          '</div>' +
          '<div class="px-4 pt-3"><div class="tab-strip" id="cat-tabs"></div></div>' +
          '<div class="p-4">' +
            '<div class="table-wrap"><table class="data-table"><thead><tr id="cat-thead"></tr></thead><tbody id="cat-tbody">' + skeletonRows(4, 4) + '</tbody></table></div>' +
            '<div class="pt-3" id="cat-pagination"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    const tabs = $id('cat-tabs');
    tabs.innerHTML = CATALOGS.map((c) =>
      '<button class="tab-item' + (state.catalogs.activeCatalog === c.id ? ' is-active' : '') + '" data-cat="' + c.id + '">' + escapeHtml(c.label) + '</button>'
    ).join('');
    $qsa('#cat-tabs .tab-item').forEach((b) => b.addEventListener('click', () => {
      state.catalogs.activeCatalog = b.dataset.cat;
      state.catalogs.page = 1;
      $qsa('#cat-tabs .tab-item').forEach((x) => x.classList.toggle('is-active', x.dataset.cat === b.dataset.cat));
      loadCatalogs();
    }));
    $qs('[data-act="add"]', root).addEventListener('click', () => openCatalogModal(null));
    loadCatalogs();
  }
  async function loadCatalogs() {
    const cat = state.catalogs.activeCatalog;
    const cfg = CATALOGS.find((c) => c.id === cat);
    const thead = $id('cat-thead');
    if (thead) thead.innerHTML = '<th>Name</th>' + (cfg.columns.filter((c) => c !== 'name').map((c) => '<th>' + escapeHtml(c.replace(/_/g,' ').replace(/\b\w/g, m => m.toUpperCase())) + '</th>').join('')) + '<th>Actions</th>';
    const tbody = $id('cat-tbody');
    if (!tbody) return;
    state.catalogs.loading = true;
    tbody.innerHTML = skeletonRows((cfg.columns.length + 2), 4);
    const q = new URLSearchParams();
    q.set('page', state.catalogs.page);
    q.set('limit', state.catalogs.limit);
    try {
      const body = await apiJson(API + '/admin/catalogs/' + cat + '?' + q.toString());
      const data = (body && body.data) || [];
      state.catalogs.data = data;
      state.catalogs.pagination = body && body.pagination ? body.pagination : null;
      renderCatalogsTable(data, body && body.pagination, cfg);
    } catch (err) {
      if (err && err.auth) return;
      tbody.innerHTML = '<tr><td colspan="' + (cfg.columns.length + 2) + '">' + emptyState('Failed to load: ' + escapeHtml(err.message), svg(ICONS.catalogs, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } finally {
      state.catalogs.loading = false;
    }
  }
  function renderCatalogsTable(rows, pagination, cfg) {
    const tbody = $id('cat-tbody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (cfg.columns.length + 2) + '">' + emptyState('No ' + cfg.label.toLowerCase() + ' yet.', svg(ICONS.catalogs, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } else {
      tbody.innerHTML = rows.map((r) => {
        let cells = '<td class="text-white">' + escapeHtml(r.name || '—') + '</td>';
        cfg.columns.filter((c) => c !== 'name').forEach((c) => {
          let v = r[c];
          if (c === 'is_critical') v = v ? '<span class="badge badge-critical">Critical</span>' : '<span class="badge badge-slate">Normal</span>';
          else if (v === null || v === undefined || v === '') v = '<span class="text-ink-faint">—</span>';
          else v = escapeHtml(String(v));
          cells += '<td>' + v + '</td>';
        });
        const id = r.id;
        cells += '<td class="text-right"><div class="flex gap-1 justify-end"><button class="btn btn-ghost px-2 py-1 text-xs" data-act="edit" data-id="' + id + '">' + svg(ICONS.pencil, 'w-3.5 h-3.5') + '</button><button class="btn btn-danger px-2 py-1 text-xs" data-act="del" data-id="' + id + '">' + svg(ICONS.trash, 'w-3.5 h-3.5') + '</button></div></td>';
        return '<tr>' + cells + '</tr>';
      }).join('');
      $qsa('#cat-tbody [data-act="edit"]').forEach((b) => b.addEventListener('click', () => openCatalogModal(b.dataset.id)));
      $qsa('#cat-tbody [data-act="del"]').forEach((b) => b.addEventListener('click', () => deleteCatalog(b.dataset.id)));
    }
    const p = $id('cat-pagination');
    if (p) {
      p.innerHTML = paginationFooter(pagination, () => { state.catalogs.page--; loadCatalogs(); }, () => { state.catalogs.page++; loadCatalogs(); }, { limit: state.catalogs.limit });
      bindPagination('#cat-pagination', () => { state.catalogs.page--; loadCatalogs(); }, () => { state.catalogs.page++; loadCatalogs(); });
    }
  }
  function openCatalogModal(id) {
    const cat = state.catalogs.activeCatalog;
    const cfg = CATALOGS.find((c) => c.id === cat);
    let existing = null;
    if (id) existing = state.catalogs.data.find((r) => String(r.id) === String(id));
    const form = el('form', { id: 'cat-form', class: 'space-y-3' });
    let fieldsHtml = '';
    cfg.columns.forEach((col) => {
      const label = col.replace(/_/g,' ').replace(/\b\w/g, m => m.toUpperCase());
      if (col === 'is_critical') {
        const checked = existing && existing.is_critical;
        fieldsHtml += '<label class="flex items-center gap-2 text-sm text-ink-text"><input type="checkbox" name="is_critical" ' + (checked ? 'checked' : '') + ' class="w-4 h-4 rounded" /> <span>Is critical (auto-alerts on selection)</span></label>';
      } else {
        const val = existing ? (existing[col] || '') : '';
        fieldsHtml += '<div><label class="block text-xs text-ink-muted mb-1">' + escapeHtml(label) + '</label><input type="text" name="' + col + '" class="input" value="' + escapeHtml(val) + '" /></div>';
      }
    });
    form.innerHTML = fieldsHtml;
    openModal((id ? 'Edit ' : 'Add ') + cfg.label.replace(/s$/, ''), form, {
      footer: [
        { label: 'Cancel', variant: 'btn-ghost', onClick: closeModal },
        { label: id ? 'Save' : 'Create', variant: 'btn-primary', onClick: async () => {
          const fd = new FormData(form);
          const payload = {};
          cfg.columns.forEach((col) => {
            if (col === 'is_critical') payload[col] = !!fd.get('is_critical');
            else payload[col] = (fd.get(col) || '').toString().trim();
          });
          try {
            if (id) await apiJson(API + '/admin/catalogs/' + cat + '/' + encodeURIComponent(id), { method: 'PUT', body: payload });
            else    await apiJson(API + '/admin/catalogs/' + cat, { method: 'POST', body: payload });
            toast(cfg.label.replace(/s$/, '') + ' ' + (id ? 'updated' : 'created') + '.', 'success');
            closeModal();
            loadCatalogs();
          } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
        } },
      ]
    });
  }
  async function deleteCatalog(id) {
    const cat = state.catalogs.activeCatalog;
    if (!confirm('Delete this ' + cat.replace(/s$/, '') + '? This cannot be undone.')) return;
    try {
      await apiJson(API + '/admin/catalogs/' + cat + '/' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Deleted.', 'success');
      loadCatalogs();
    } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
  }

  /* =========================================================
   * 8. THRESHOLDS VIEW
   * ========================================================= */
  async function renderThresholdsView(root) {
    state.thresholds.loading = true;
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="card p-0 overflow-hidden">' +
          '<div class="p-4 flex items-center justify-between border-b border-white/8">' +
            '<h3 class="text-sm font-semibold text-white">Alert Thresholds</h3>' +
            '<button class="btn btn-primary text-xs px-3 py-1.5" data-act="add">' + svg(ICONS.plus, 'w-3.5 h-3.5') + ' Add</button>' +
          '</div>' +
          '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Parameter</th><th>Warning</th><th>Critical</th><th>Operator</th><th>Active</th><th>Actions</th>' +
          '</tr></thead><tbody id="thr-tbody">' + skeletonRows(6, 3) + '</tbody></table></div>' +
        '</div>' +
      '</div>';
    $qs('[data-act="add"]', root).addEventListener('click', () => openThresholdModal(null));
    loadThresholds();
  }
  async function loadThresholds() {
    const tbody = $id('thr-tbody');
    if (!tbody) return;
    state.thresholds.loading = true;
    tbody.innerHTML = skeletonRows(6, 3);
    try {
      const body = await apiJson(API + '/admin/thresholds');
      const data = (body && body.data) || [];
      state.thresholds.data = data;
      renderThresholdsTable(data);
    } catch (err) {
      if (err && err.auth) return;
      tbody.innerHTML = '<tr><td colspan="6">' + emptyState('Failed to load: ' + escapeHtml(err.message), svg(ICONS.thresholds, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
    } finally {
      state.thresholds.loading = false;
    }
  }
  function renderThresholdsTable(rows) {
    const tbody = $id('thr-tbody');
    if (!tbody) return;
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">' + emptyState('No thresholds configured. Add one to start auto-evaluating patient readings.', svg(ICONS.thresholds, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((t) => {
      const active = t.is_active !== false && t.is_active !== 0;
      return '<tr>' +
        '<td class="font-mono text-white">' + escapeHtml(t.parameter_name || '—') + '</td>' +
        '<td class="font-mono">' + escapeHtml(String(t.warning_value !== null && t.warning_value !== undefined ? t.warning_value : '—')) + '</td>' +
        '<td class="font-mono text-rose-300">' + escapeHtml(String(t.critical_value !== null && t.critical_value !== undefined ? t.critical_value : '—')) + '</td>' +
        '<td class="font-mono">' + escapeHtml(t.operator || '>') + '</td>' +
        '<td>' + (active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-slate">Disabled</span>') + '</td>' +
        '<td class="text-right"><div class="flex gap-1 justify-end"><button class="btn btn-ghost px-2 py-1 text-xs" data-act="edit" data-id="' + t.id + '">' + svg(ICONS.pencil, 'w-3.5 h-3.5') + '</button><button class="btn btn-danger px-2 py-1 text-xs" data-act="del" data-id="' + t.id + '">' + svg(ICONS.trash, 'w-3.5 h-3.5') + '</button></div></td>' +
      '</tr>';
    }).join('');
    $qsa('#thr-tbody [data-act="edit"]').forEach((b) => b.addEventListener('click', () => openThresholdModal(b.dataset.id)));
    $qsa('#thr-tbody [data-act="del"]').forEach((b) => b.addEventListener('click', () => deleteThreshold(b.dataset.id)));
  }
  function openThresholdModal(id) {
    let existing = null;
    if (id) existing = state.thresholds.data.find((t) => String(t.id) === String(id));
    const form = el('form', { id: 'thr-form', class: 'space-y-3' });
    form.innerHTML =
      '<div><label class="block text-xs text-ink-muted mb-1">Parameter</label>' +
        '<select name="parameter_name" class="select">' +
          ['bp_systolic','bp_diastolic','heart_rate'].map((p) => '<option value="' + p + '"' + (existing && existing.parameter_name === p ? ' selected' : '') + '>' + p + '</option>').join('') +
        '</select></div>' +
      '<div class="grid grid-cols-2 gap-3">' +
        '<div><label class="block text-xs text-ink-muted mb-1">Warning value</label><input name="warning_value" type="number" step="0.1" class="input" value="' + (existing ? (existing.warning_value || '') : '') + '" /></div>' +
        '<div><label class="block text-xs text-ink-muted mb-1">Critical value</label><input name="critical_value" type="number" step="0.1" class="input" value="' + (existing ? (existing.critical_value || '') : '') + '" /></div>' +
      '</div>' +
      '<div><label class="block text-xs text-ink-muted mb-1">Operator</label>' +
        '<select name="operator" class="select">' +
          ['>','<','>=','<='].map((op) => '<option value="' + op + '"' + (existing && existing.operator === op ? ' selected' : '') + '>' + op + '</option>').join('') +
        '</select></div>' +
      '<label class="flex items-center gap-2 text-sm text-ink-text"><input type="checkbox" name="is_active" ' + (!existing || (existing.is_active !== false && existing.is_active !== 0) ? 'checked' : '') + ' class="w-4 h-4 rounded" /> <span>Active</span></label>';
    openModal((id ? 'Edit' : 'Add') + ' Threshold', form, {
      footer: [
        { label: 'Cancel', variant: 'btn-ghost', onClick: closeModal },
        { label: id ? 'Save' : 'Create', variant: 'btn-primary', onClick: async () => {
          const fd = new FormData(form);
          const payload = {
            parameter_name: fd.get('parameter_name'),
            warning_value: Number(fd.get('warning_value')),
            critical_value: Number(fd.get('critical_value')),
            operator: fd.get('operator'),
            is_active: !!fd.get('is_active'),
          };
          try {
            if (id) await apiJson(API + '/admin/thresholds/' + encodeURIComponent(id), { method: 'PUT', body: payload });
            else    await apiJson(API + '/admin/thresholds', { method: 'POST', body: payload });
            toast('Threshold ' + (id ? 'updated' : 'created') + '.', 'success');
            closeModal();
            loadThresholds();
          } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
        } },
      ]
    });
  }
  async function deleteThreshold(id) {
    if (!confirm('Delete this threshold?')) return;
    try {
      await apiJson(API + '/admin/thresholds/' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Threshold deleted.', 'success');
      loadThresholds();
    } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
  }

  /* =========================================================
   * 9. WORKING HOURS VIEW (weekly grid + availability status)
   * ========================================================= */
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  async function renderWorkingHoursView(root) {
    state.workingHours.loading = true;
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="card p-5">' +
          '<h3 class="text-sm font-semibold text-white mb-3">Doctor Status</h3>' +
          '<div id="wh-avail" class="grid grid-cols-1 sm:grid-cols-3 gap-3"></div>' +
        '</div>' +
        '<div class="card p-5">' +
          '<div class="flex items-center justify-between mb-3">' +
            '<h3 class="text-sm font-semibold text-white">Weekly Working Hours</h3>' +
            '<button class="btn btn-primary text-xs px-3 py-1.5" data-act="save-all">' + svg(ICONS.check, 'w-3.5 h-3.5') + ' Save All</button>' +
          '</div>' +
          '<div id="wh-grid" class="space-y-2"></div>' +
        '</div>' +
      '</div>';
    $qs('[data-act="save-all"]', root).addEventListener('click', saveAllWorkingHours);
    loadWorkingHours();
  }
  async function loadWorkingHours() {
    try {
      const [whRes, avRes] = await Promise.allSettled([
        apiJson(API + '/admin/working-hours').catch(() => null),
        apiJson(API + '/admin/availability-status').catch(() => null),
      ]);
      const rows = (whRes && whRes.value && whRes.value.data) || [];
      const avail = (avRes && avRes.value && avRes.value.data && (avRes.value.data.status || avRes.value.data)) || 'active';
      state.workingHours.rows = rows;
      state.workingHours.availability = avail;
      renderAvailabilityStatus();
      renderWorkingHoursGrid();
    } catch (err) { if (err && err.auth) return; toast('Failed to load working hours: ' + err.message, 'error'); }
  }
  function renderAvailabilityStatus() {
    const wrap = $id('wh-avail');
    if (!wrap) return;
    const cur = state.workingHours.availability || 'active';
    const opts = [
      { id: 'active',                label: 'Active',                desc: 'Accepting appointments' },
      { id: 'off_today',             label: 'Off Today',             desc: 'No appointments today' },
      { id: 'after_hours_emergency', label: 'After-Hours Emergency', desc: 'Emergency only' },
    ];
    wrap.innerHTML = opts.map((o) =>
      '<button class="avail-opt' + (cur === o.id ? ' is-selected' : '') + '" data-status="' + o.id + '">' +
        '<div class="text-sm font-semibold text-white">' + escapeHtml(o.label) + '</div>' +
        '<div class="text-[10px] text-ink-faint mt-0.5">' + escapeHtml(o.desc) + '</div>' +
      '</button>'
    ).join('');
    $qsa('#wh-avail .avail-opt').forEach((b) => {
      b.addEventListener('click', async () => {
        state.workingHours.availability = b.dataset.status;
        $qsa('#wh-avail .avail-opt').forEach((x) => x.classList.toggle('is-selected', x.dataset.status === b.dataset.status));
        try {
          await apiJson(API + '/admin/availability-status', { method: 'PUT', body: { status: b.dataset.status } });
          toast('Availability status updated.', 'success');
        } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
      });
    });
  }
  function renderWorkingHoursGrid() {
    const wrap = $id('wh-grid');
    if (!wrap) return;
    const rows = DAYS.map((day, i) => {
      const r = state.workingHours.rows.find((x) => Number(x.day_of_week) === i) || { day_of_week: i, start_time: '09:00', end_time: '17:00', is_active: false };
      return '<div class="wh-row">' +
        '<div class="text-sm font-medium text-white">' + escapeHtml(day) + '</div>' +
        '<input type="time" class="input text-xs" data-dow="' + i + '" data-field="start_time" value="' + escapeHtml(r.start_time || '09:00') + '" />' +
        '<input type="time" class="input text-xs" data-dow="' + i + '" data-field="end_time" value="' + escapeHtml(r.end_time || '17:00') + '" />' +
        '<label class="flex items-center gap-1.5 text-xs text-ink-text"><input type="checkbox" class="w-4 h-4 rounded" data-dow="' + i + '" data-field="is_active" ' + (r.is_active ? 'checked' : '') + ' /> Active</label>' +
        '<div></div>' +
      '</div>';
    });
    wrap.innerHTML = rows.join('');
  }
  async function saveAllWorkingHours() {
    const inputs = $qsa('#wh-grid [data-dow]');
    const byDay = {};
    inputs.forEach((inp) => {
      const dow = inp.dataset.dow;
      const field = inp.dataset.field;
      if (!byDay[dow]) byDay[dow] = { day_of_week: Number(dow) };
      if (field === 'is_active') byDay[dow][field] = inp.checked;
      else byDay[dow][field] = inp.value;
    });
    const promises = Object.values(byDay).map((row) =>
      apiJson(API + '/admin/working-hours', { method: 'PUT', body: row }).catch((e) => e)
    );
    try {
      const results = await Promise.all(promises);
      const failures = results.filter((r) => r instanceof Error);
      if (failures.length) toast(failures.length + ' row(s) failed to save.', 'error');
      else toast('Working hours saved.', 'success');
      loadWorkingHours();
    } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
  }

  /* =========================================================
   * 10. PROFILE VIEW (name + phone + change password)
   * ========================================================= */
  async function renderProfileView(root) {
    state.profile.loading = true;
    root.innerHTML =
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' +
        '<div class="card p-5">' +
          '<h3 class="text-sm font-semibold text-white mb-3">Profile Information</h3>' +
          '<form id="profile-form" class="space-y-3">' +
            '<div><label class="block text-xs text-ink-muted mb-1">Name</label><input name="name" class="input" /></div>' +
            '<div><label class="block text-xs text-ink-muted mb-1">Phone number</label><input name="phone_number" class="input" /></div>' +
            '<div class="flex justify-end pt-2"><button type="submit" class="btn btn-primary">Save Profile</button></div>' +
          '</form>' +
        '</div>' +
        '<div class="card p-5" id="password-card">' +
          '<h3 class="text-sm font-semibold text-white mb-3">Change Password</h3>' +
          '<form id="password-form" class="space-y-3">' +
            '<div><label class="block text-xs text-ink-muted mb-1">Current password</label><input name="current_password" type="password" class="input" required /></div>' +
            '<div><label class="block text-xs text-ink-muted mb-1">New password</label><input name="new_password" type="password" class="input" required minlength="8" /></div>' +
            '<div><label class="block text-xs text-ink-muted mb-1">Confirm new password</label><input name="confirm_password" type="password" class="input" required minlength="8" /></div>' +
            '<p id="pw-match" class="text-xs text-ink-faint"></p>' +
            '<div class="flex justify-end pt-2"><button type="submit" class="btn btn-primary">Update Password</button></div>' +
          '</form>' +
        '</div>' +
      '</div>';
    // Prefill
    try {
      const body = await apiJson(API + '/auth/me');
      const u = (body && body.data) || {};
      state.user = Object.assign({}, state.user || {}, u);
      setUser(state.user);
      renderUserChip();
      const form = $id('profile-form');
      form.querySelector('[name="name"]').value = u.name || '';
      form.querySelector('[name="phone_number"]').value = u.phone_number || '';
    } catch (err) { if (err && err.auth) return; toast('Failed to load profile: ' + err.message, 'error'); }
    // Bind
    $id('profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { name: fd.get('name'), phone_number: fd.get('phone_number') };
      try {
        const body = await apiJson(API + '/auth/profile', { method: 'PUT', body: payload });
        const u = (body && body.data) || Object.assign({}, state.user || {}, payload);
        state.user = u; setUser(u); renderUserChip();
        toast('Profile updated.', 'success');
      } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
    });
    const pwForm = $id('password-form');
    const newPw = pwForm.querySelector('[name="new_password"]');
    const confPw = pwForm.querySelector('[name="confirm_password"]');
    const matchHint = $id('pw-match');
    confPw.addEventListener('input', () => {
      const match = newPw.value === confPw.value;
      matchHint.textContent = match ? 'Passwords match.' : (confPw.value ? 'Passwords do not match.' : '');
      matchHint.className = 'text-xs ' + (match ? 'text-emerald-400' : 'text-rose-400');
    });
    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (fd.get('new_password') !== fd.get('confirm_password')) { toast('New password and confirmation do not match.', 'error'); return; }
      try {
        await apiJson(API + '/auth/password', { method: 'PUT', body: { current_password: fd.get('current_password'), new_password: fd.get('new_password') } });
        toast('Password updated.', 'success');
        pwForm.reset();
      } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
    });
  }

  /* =========================================================
   * 11. SETTINGS VIEW (Telegram + Backup + Logout)
   * ========================================================= */
  async function renderSettingsView(root) {
    state.settings = null;
    state.backupInfo = null;
    root.innerHTML =
      '<div class="space-y-4">' +
        // (a) Telegram card
        '<div class="card p-5">' +
          '<h3 class="text-sm font-semibold text-white mb-3 flex items-center gap-2">' + svg(ICONS.mail, 'w-4 h-4 text-brand-accent') + ' Telegram & WhatsApp</h3>' +
          '<form id="settings-form" class="space-y-3">' +
            '<div><label class="block text-xs text-ink-muted mb-1">Bot token</label><input name="telegram_bot_token" type="password" class="input font-mono text-xs" placeholder="123456789:ABCdef…" /></div>' +
            '<div><label class="block text-xs text-ink-muted mb-1">Telegram chat ID (file storage group)</label><input name="telegram_chat_id" class="input font-mono text-xs" placeholder="-1001234567890" /></div>' +
            '<div><label class="block text-xs text-ink-muted mb-1">Telegram alerts chat ID (separate alerts group)</label><input name="telegram_alerts_chat_id" class="input font-mono text-xs" placeholder="-1009876543210" /></div>' +
            '<div><label class="block text-xs text-ink-muted mb-1">Doctor WhatsApp (public number for deeplinks)</label><input name="doctor_whatsapp" class="input font-mono text-xs" placeholder="201000000000" /></div>' +
            '<div class="flex flex-wrap justify-between gap-2 pt-2 border-t border-white/8">' +
              '<button type="button" class="btn btn-ghost text-xs" data-act="test-telegram">' + svg(ICONS.send, 'w-3.5 h-3.5') + ' Test Connection</button>' +
              '<button type="submit" class="btn btn-primary text-xs">Save Settings</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
        // (b) Backup card
        '<div class="card p-5">' +
          '<h3 class="text-sm font-semibold text-white mb-3 flex items-center gap-2">' + svg(ICONS.database, 'w-4 h-4 text-brand-accent') + ' Database Backup</h3>' +
          '<div id="backup-info" class="space-y-2 text-xs text-ink-muted">' + '<div class="skeleton h-4 w-40"></div>'.repeat(3) + '</div>' +
          '<div class="mt-4"><button class="btn btn-accent text-xs" data-act="download-backup">' + svg(ICONS.download, 'w-3.5 h-3.5') + ' Download DB Snapshot</button></div>' +
        '</div>' +
        // (c) Logout
        '<div class="card p-5">' +
          '<h3 class="text-sm font-semibold text-white mb-2">Session</h3>' +
          '<p class="text-xs text-ink-muted mb-3">Sign out of the admin dashboard.</p>' +
          '<button class="btn btn-danger text-xs" data-act="logout">' + svg(ICONS.logout, 'w-3.5 h-3.5') + ' Logout</button>' +
        '</div>' +
      '</div>';
    $qs('[data-act="test-telegram"]', root).addEventListener('click', () => openTestTelegramModal());
    $qs('[data-act="download-backup"]', root).addEventListener('click', () => openBackupPasscodeModal());
    $qs('[data-act="logout"]', root).addEventListener('click', () => logout());
    // Prefill settings
    try {
      const body = await apiJson(API + '/admin/settings');
      const s = (body && body.data) || {};
      state.settings = s;
      const form = $id('settings-form');
      form.querySelector('[name="telegram_bot_token"]').value = s.telegram_bot_token || '';
      form.querySelector('[name="telegram_chat_id"]').value = s.telegram_chat_id || '';
      form.querySelector('[name="telegram_alerts_chat_id"]').value = s.telegram_alerts_chat_id || '';
      form.querySelector('[name="doctor_whatsapp"]').value = s.doctor_whatsapp || '';
    } catch (err) { if (err && err.auth) return; toast('Failed to load settings: ' + err.message, 'error'); }
    // Prefill backup info
    try {
      const body = await apiJson(API + '/admin/backup-db/info');
      const info = (body && body.data) || {};
      state.backupInfo = info;
      const wrap = $id('backup-info');
      wrap.innerHTML =
        '<div class="flex justify-between"><span>Enabled:</span><span>' + (info.enabled ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-slate">No</span>') + '</span></div>' +
        '<div class="flex justify-between"><span>DB path:</span><code class="chip">' + escapeHtml(info.db_path || '—') + '</code></div>' +
        '<div class="flex justify-between"><span>DB size:</span><span class="text-white font-mono">' + escapeHtml(info.db_size_human || '—') + '</span></div>' +
        '<div class="flex justify-between"><span>Rate limit:</span><span class="text-white font-mono">' + escapeHtml(String(info.rate_limit || '3 / 15 min per IP')) + '</span></div>';
    } catch (err) { if (err && err.auth) return; /* info may fail silently */ }
    // Bind save
    $id('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        telegram_bot_token: fd.get('telegram_bot_token'),
        telegram_chat_id: fd.get('telegram_chat_id'),
        telegram_alerts_chat_id: fd.get('telegram_alerts_chat_id'),
        doctor_whatsapp: fd.get('doctor_whatsapp'),
      };
      try {
        await apiJson(API + '/admin/settings', { method: 'PUT', body: payload });
        toast('Settings saved.', 'success');
      } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
    });
  }
  function openTestTelegramModal() {
    const form = el('form', { id: 'tg-test-form', class: 'space-y-3' });
    form.innerHTML =
      '<div><label class="block text-xs text-ink-muted mb-1">Bot token</label><input name="token" type="password" class="input font-mono text-xs" placeholder="123456789:ABC…" /></div>' +
      '<div><label class="block text-xs text-ink-muted mb-1">Chat ID</label><input name="chat_id" class="input font-mono text-xs" placeholder="-1001234567890" /></div>';
    if (state.settings) {
      form.querySelector('[name="token"]').value = state.settings.telegram_bot_token || '';
      form.querySelector('[name="chat_id"]').value = state.settings.telegram_chat_id || '';
    }
    openModal('Test Telegram Connection', form, {
      footer: [
        { label: 'Cancel', variant: 'btn-ghost', onClick: closeModal },
        { label: 'Send Test', variant: 'btn-primary', onClick: async () => {
          const fd = new FormData(form);
          try {
            await apiJson(API + '/admin/settings/test-telegram', { method: 'POST', body: { token: fd.get('token'), chat_id: fd.get('chat_id') } });
            toast('Test message sent. Check your Telegram.', 'success');
            closeModal();
          } catch (err) { if (err && err.auth) return; toast('Failed: ' + err.message, 'error'); }
        } },
      ]
    });
  }
  function openBackupPasscodeModal() {
    const form = el('form', { id: 'backup-form', class: 'space-y-3' });
    form.innerHTML =
      '<div><label class="block text-xs text-ink-muted mb-1">Backup passcode</label><input name="passcode" type="password" class="input" required placeholder="Enter passcode" /></div>' +
      '<p class="text-[10px] text-ink-faint">Rate-limited to 3 attempts per 15 minutes per IP.</p>';
    openModal('Download DB Snapshot', form, {
      footer: [
        { label: 'Cancel', variant: 'btn-ghost', onClick: closeModal },
        { label: 'Download', variant: 'btn-accent', onClick: async () => {
          const fd = new FormData(form);
          try {
            // Use raw fetch — we want the binary blob, not the JSON envelope.
            const res = await fetch(API + '/admin/backup-db', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
              credentials: 'same-origin',
              body: JSON.stringify({ passcode: fd.get('passcode') })
            });
            if (res.status === 401) { handle401(); return; }
            if (!res.ok) {
              let msg = 'Download failed (HTTP ' + res.status + ')';
              try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (_) {}
              toast(msg, 'error'); return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = res.headers.get('X-Backup-File') || 'medical-backup.db';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast('Snapshot downloaded.', 'success');
            closeModal();
          } catch (err) { toast('Network error: ' + err.message, 'error'); }
        } },
      ]
    });
  }

  /* =========================================================
   * TECHNICAL MODE — full sections (no longer placeholders)
   * 1. System Metrics (server health + DB + users + requests + donut + top endpoints)
   * 2. Request Logs (paginated + filtered + auto-refresh)
   * 3. Audit Trail (paginated + action filter)
   * 4. Backup Operations (info + download + recent backup audit log)
   * ========================================================= */

  // ── 1. TECH METRICS ──
  function renderTechMetricsView(root) {
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="flex items-center justify-between">' +
          '<h2 class="text-lg font-semibold text-white">System Metrics</h2>' +
          '<button class="btn btn-ghost text-xs" data-act="refresh">' + svg(ICONS.refresh, 'w-3.5 h-3.5') + ' Refresh</button>' +
        '</div>' +
        '<div id="tech-metrics-content"><div class="card p-8 text-center text-ink-muted">Loading metrics…</div></div>' +
      '</div>';
    $qs('[data-act="refresh"]', root).addEventListener('click', () => loadTechMetrics());
    loadTechMetrics();
  }

  async function loadTechMetrics() {
    const wrap = $id('tech-metrics-content');
    if (!wrap) return;
    try {
      const [mRes, sbRes, teRes] = await Promise.allSettled([
        apiJson(API + '/admin/metrics').catch(() => null),
        apiJson(API + '/admin/logs/status-breakdown').catch(() => null),
        apiJson(API + '/admin/logs/top-endpoints').catch(() => null),
      ]);
      const m = mRes.value && mRes.value.data ? mRes.value.data : null;
      const sb = sbRes.value && sbRes.value.data ? sbRes.value.data : [];
      const te = teRes.value && teRes.value.data ? teRes.value.data : [];

      if (!m) {
        wrap.innerHTML = '<div class="card p-8 text-center text-ink-muted">Failed to load metrics.</div>';
        return;
      }

      const sys = m.system || {};
      const db = m.database || {};
      const users = m.users || {};
      const reqs = m.requests || {};
      const byStatus = users.by_status || {};
      const uptimeStr = formatUptime(m.uptime_seconds);

      wrap.innerHTML =
        // ── Server card ──
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">' +
          techInfoCard('Server', [
            ['Uptime', uptimeStr],
            ['Server time', m.server_time || '—'],
            ['Node.js', sys.node_version || '—'],
            ['Platform', sys.platform || '—'],
            ['CPU cores', String(sys.cpu_count || '—')],
            ['RSS memory', sys.rss_human || '—'],
          ], ICONS.cpu, 'accent-brand') +
          techInfoCard('Database', [
            ['Path', (db.path || '—').replace(/^.*\//, '')],
            ['Full path', db.path || '—'],
            ['Size', db.size_human || '—'],
            ['Journal mode', db.journal_mode || '—'],
          ], ICONS.database, 'accent-emerald') +
          techInfoCard('Users', [
            ['Total', String(users.total || 0)],
            ['Patients', String(users.patients || 0)],
            ['Admins', String(users.admins || 0)],
            ['Active', String(byStatus.active || 0)],
            ['Suspended', String(byStatus.suspended || 0)],
          ], ICONS.users, 'accent-amber') +
          techInfoCard('Requests', [
            ['Total', (reqs.total || 0).toLocaleString()],
            ['Last 24h', (reqs.last_24h || 0).toLocaleString()],
            ['Timestamp', m.server_time || '—'],
          ], ICONS.activity, 'accent-rose') +
        '</div>' +
        // ── Donut + top endpoints ──
        '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' +
          '<div class="card p-5">' +
            '<h3 class="text-sm font-semibold text-white mb-3">HTTP Status Breakdown</h3>' +
            '<div class="flex items-center gap-6">' +
              '<div id="status-donut-wrap" style="width:180px;height:180px"></div>' +
              '<div id="status-legend" class="space-y-1.5 text-xs"></div>' +
            '</div>' +
            '<p class="text-xs text-ink-faint mt-3">Last 24 hours of request logs</p>' +
          '</div>' +
          '<div class="card p-5">' +
            '<h3 class="text-sm font-semibold text-white mb-3">Top Endpoints (by request volume)</h3>' +
            '<div id="top-endpoints" class="space-y-1"></div>' +
          '</div>' +
        '</div>';

      renderStatusDonut(sb);
      renderTopEndpoints(te);
    } catch (err) {
      wrap.innerHTML = '<div class="card p-8 text-center text-rose-400">Error loading metrics: ' + escapeHtml(err.message || String(err)) + '</div>';
    }
  }

  function techInfoCard(title, rows, iconPath, accent) {
    return '<div class="card p-5 ' + (accent || '') + '">' +
      '<div class="flex items-center gap-2 mb-3">' +
        '<div class="w-8 h-8 rounded-lg bg-brand/15 text-brand-accent flex items-center justify-center">' + svg(iconPath, 'w-4 h-4') + '</div>' +
        '<h3 class="text-sm font-semibold text-white">' + escapeHtml(title) + '</h3>' +
      '</div>' +
      '<dl class="space-y-1.5">' +
        rows.map(function(r) {
          return '<div class="flex justify-between gap-2 text-xs">' +
            '<dt class="text-ink-muted">' + escapeHtml(r[0]) + '</dt>' +
            '<dd class="font-mono text-white text-left truncate" title="' + escapeHtml(String(r[1])) + '">' + escapeHtml(String(r[1])) + '</dd>' +
          '</div>';
        }).join('') +
      '</dl>' +
    '</div>';
  }

  function formatUptime(seconds) {
    if (!seconds && seconds !== 0) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  // ── 2. TECH REQUEST LOGS ──
  function renderTechLogsView(root) {
    state.techLogs = Object.assign({}, state.techLogs || {}, { data: [], loading: false, page: 1, limit: 50, statusFilter: '', methodFilter: '', search: '', pagination: null, autoRefresh: false, lastFetch: null, lastFetchAt: 0 });
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="flex items-center justify-between flex-wrap gap-2">' +
          '<h2 class="text-lg font-semibold text-white">Request Logs</h2>' +
          '<div class="flex items-center gap-2">' +
            '<span id="logs-last-updated" class="text-xs text-ink-faint"></span>' +
            '<button class="btn btn-ghost text-xs" data-act="refresh">' + svg(ICONS.refresh, 'w-3.5 h-3.5') + ' Refresh</button>' +
          '</div>' +
        '</div>' +
        '<div class="card p-3 flex flex-wrap items-center gap-2">' +
          '<select id="logs-status-filter" class="select text-xs py-1.5">' +
            '<option value="">All statuses</option>' +
            '<option value="2">2xx Success</option>' +
            '<option value="3">3xx Redirect</option>' +
            '<option value="4">4xx Client error</option>' +
            '<option value="5">5xx Server error</option>' +
          '</select>' +
          '<select id="logs-method-filter" class="select text-xs py-1.5">' +
            '<option value="">All methods</option>' +
            '<option value="GET">GET</option>' +
            '<option value="POST">POST</option>' +
            '<option value="PUT">PUT</option>' +
            '<option value="PATCH">PATCH</option>' +
            '<option value="DELETE">DELETE</option>' +
          '</select>' +
          '<input id="logs-search" type="search" placeholder="Search path…" class="input text-xs py-1.5 w-48" />' +
          '<label class="flex items-center gap-1.5 text-xs text-ink-muted ml-auto">' +
            '<input id="logs-auto-refresh" type="checkbox" class="accent-brand" /> Auto-refresh (15s)' +
          '</label>' +
          '<button class="btn btn-ghost text-xs" data-act="clear">Clear filters</button>' +
        '</div>' +
        '<div class="card overflow-hidden">' +
          '<div class="overflow-x-auto">' +
            '<table class="w-full text-xs">' +
              '<thead class="bg-surface-2 text-ink-faint">' +
                '<tr>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Method</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Path</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Status</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Duration</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">IP</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">User</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Time</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody id="logs-tbody"></tbody>' +
            '</table>' +
          '</div>' +
          '<div class="p-3" id="logs-pagination"></div>' +
        '</div>' +
      '</div>';
    $qs('[data-act="refresh"]', root).addEventListener('click', () => loadTechLogs());
    $qs('[data-act="clear"]', root).addEventListener('click', () => {
      $id('logs-status-filter').value = '';
      $id('logs-method-filter').value = '';
      $id('logs-search').value = '';
      state.techLogs.statusFilter = '';
      state.techLogs.methodFilter = '';
      state.techLogs.search = '';
      state.techLogs.page = 1;
      loadTechLogs();
    });
    $id('logs-status-filter').addEventListener('change', (e) => { state.techLogs.statusFilter = e.target.value; state.techLogs.page = 1; loadTechLogs(); });
    $id('logs-method-filter').addEventListener('change', (e) => { state.techLogs.methodFilter = e.target.value; state.techLogs.page = 1; loadTechLogs(); });
    const searchDeb = debounce(() => { state.techLogs.search = $id('logs-search').value.trim(); state.techLogs.page = 1; loadTechLogs(); }, 300);
    $id('logs-search').addEventListener('input', searchDeb);
    $id('logs-auto-refresh').addEventListener('change', (e) => {
      state.techLogs.autoRefresh = e.target.checked;
      if (state.techLogs.autoRefresh) { startLogsAutoRefresh(); } else { stopLogsAutoRefresh(); }
    });
    loadTechLogs();
  }

  async function loadTechLogs() {
    const tbody = $id('logs-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-ink-muted">Loading…</td></tr>';
    try {
      const s = state.techLogs;
      const params = new URLSearchParams({ page: String(s.page), limit: String(s.limit) });
      const body = await apiJson(API + '/admin/logs?' + params.toString());
      const data = (body && body.data) || [];
      const pagination = body && body.pagination ? body.pagination : null;
      s.data = data;
      s.pagination = pagination;
      s.lastFetch = new Date();
      s.lastFetchAt = Date.now();
      updateLogsLastUpdated();
      renderLogsTable(data, pagination);
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-rose-400">Error: ' + escapeHtml(err.message || String(err)) + '</td></tr>';
    }
  }

  function renderLogsTable(rows, pagination) {
    const s = state.techLogs;
    const tbody = $id('logs-tbody');
    if (!tbody) return;
    // Client-side filters (the API doesn't support method/search/status-class query params)
    let filtered = rows || [];
    if (s.statusFilter) filtered = filtered.filter((r) => String(r.status).charAt(0) === s.statusFilter);
    if (s.methodFilter) filtered = filtered.filter((r) => (r.method || '').toUpperCase() === s.methodFilter);
    if (s.search) filtered = filtered.filter((r) => (r.path || '').toLowerCase().indexOf(s.search.toLowerCase()) > -1);

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-ink-muted">' +
        emptyState('No request logs match the filters.', svg(ICONS.list, 'w-8 h-8 text-ink-faint')) +
      '</td></tr>';
    } else {
      tbody.innerHTML = filtered.map((r) => {
        const method = (r.method || 'GET').toUpperCase();
        const status = Number(r.status || 0);
        const statusClass = status >= 500 ? 'badge-critical' : status >= 400 ? 'badge-warning' : 'badge-success';
        const dur = r.duration_ms != null ? r.duration_ms + 'ms' : '—';
        const t = relativeTime(r.created_at);
        return '<tr class="hover:bg-brand/5 border-t border-white/5">' +
          '<td class="px-3 py-2"><span class="method-badge method-' + method + '">' + method + '</span></td>' +
          '<td class="px-3 py-2 font-mono text-ink-text truncate max-w-xs">' + escapeHtml(r.path || '—') + '</td>' +
          '<td class="px-3 py-2"><span class="badge ' + statusClass + '">' + status + '</span></td>' +
          '<td class="px-3 py-2 font-mono text-ink-muted">' + dur + '</td>' +
          '<td class="px-3 py-2 font-mono text-ink-muted">' + escapeHtml(r.ip || '—') + '</td>' +
          '<td class="px-3 py-2 font-mono text-ink-muted truncate max-w-[100px]">' + escapeHtml((r.user_id || '—').slice(0, 8)) + '</td>' +
          '<td class="px-3 py-2 text-ink-muted text-xs">' + escapeHtml(t) + '</td>' +
        '</tr>';
      }).join('');
    }
    const p = $id('logs-pagination');
    if (p && pagination) {
      p.innerHTML = paginationFooter(pagination, () => { state.techLogs.page--; loadTechLogs(); }, () => { state.techLogs.page++; loadTechLogs(); }, { limit: state.techLogs.limit });
      bindPagination('#logs-pagination', () => { state.techLogs.page--; loadTechLogs(); }, () => { state.techLogs.page++; loadTechLogs(); });
    }
  }

  function updateLogsLastUpdated() {
    const el = $id('logs-last-updated');
    if (!el) return;
    if (!state.techLogs.lastFetch) { el.textContent = ''; return; }
    const secs = Math.floor((Date.now() - state.techLogs.lastFetchAt) / 1000);
    el.textContent = 'Last updated ' + (secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm') + ' ago';
  }

  function startLogsAutoRefresh() {
    stopLogsAutoRefresh();
    state.techLogs.autoTimer = setInterval(() => {
      loadTechLogs();
      updateLogsLastUpdated();
    }, 15000);
    state.techLogs.displayTimer = setInterval(updateLogsLastUpdated, 1000);
  }
  function stopLogsAutoRefresh() {
    if (state.techLogs) {
      if (state.techLogs.autoTimer) clearInterval(state.techLogs.autoTimer);
      if (state.techLogs.displayTimer) clearInterval(state.techLogs.displayTimer);
      state.techLogs.autoTimer = null;
      state.techLogs.displayTimer = null;
    }
  }

  // ── 3. TECH AUDIT TRAIL ──
  function renderTechAuditView(root) {
    state.techAudit = Object.assign({}, state.techAudit || {}, { data: [], loading: false, page: 1, limit: 50, actionFilter: '', pagination: null });
    root.innerHTML =
      '<div class="space-y-4">' +
        '<div class="flex items-center justify-between flex-wrap gap-2">' +
          '<h2 class="text-lg font-semibold text-white">Audit Trail</h2>' +
          '<button class="btn btn-ghost text-xs" data-act="refresh">' + svg(ICONS.refresh, 'w-3.5 h-3.5') + ' Refresh</button>' +
        '</div>' +
        '<div class="card p-3 flex flex-wrap items-center gap-2">' +
          '<label class="text-xs text-ink-faint">Action</label>' +
          '<select id="audit-action-filter" class="select text-xs py-1.5">' +
            '<option value="">All actions</option>' +
            '<option value="BACKUP_DOWNLOAD_SUCCESS">Backup download (success)</option>' +
            '<option value="BACKUP_DOWNLOAD_FAILURE">Backup download (failure)</option>' +
            '<option value="USER_ROLE_CHANGE">User role change</option>' +
            '<option value="USER_STATUS_CHANGE">User status change</option>' +
            '<option value="USER_DELETE">User delete</option>' +
            '<option value="TELEGRAM_TEST">Telegram test</option>' +
            '<option value="ALERT_RESOLVED">Alert resolved</option>' +
          '</select>' +
        '</div>' +
        '<div class="card overflow-hidden">' +
          '<div class="overflow-x-auto">' +
            '<table class="w-full text-xs">' +
              '<thead class="bg-surface-2 text-ink-faint">' +
                '<tr>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Time</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Action</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Actor</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">IP</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Status</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Details</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody id="audit-tbody"></tbody>' +
            '</table>' +
          '</div>' +
          '<div class="p-3" id="audit-pagination"></div>' +
        '</div>' +
      '</div>';
    $qs('[data-act="refresh"]', root).addEventListener('click', () => loadTechAudit());
    $id('audit-action-filter').addEventListener('change', (e) => { state.techAudit.actionFilter = e.target.value; state.techAudit.page = 1; loadTechAudit(); });
    loadTechAudit();
  }

  async function loadTechAudit() {
    const tbody = $id('audit-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-ink-muted">Loading…</td></tr>';
    try {
      const s = state.techAudit;
      const params = new URLSearchParams({ page: String(s.page), limit: String(s.limit) });
      if (s.actionFilter) params.set('action', s.actionFilter);
      const body = await apiJson(API + '/admin/audit-logs?' + params.toString());
      const data = (body && body.data) || [];
      const pagination = body && body.pagination ? body.pagination : null;
      s.data = data;
      s.pagination = pagination;
      renderAuditTable(data, pagination);
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-rose-400">Error: ' + escapeHtml(err.message || String(err)) + '</td></tr>';
    }
  }

  function renderAuditTable(rows, pagination) {
    const tbody = $id('audit-tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-ink-muted">' +
        emptyState('No audit log entries.', svg(ICONS.clipboard, 'w-8 h-8 text-ink-faint')) +
      '</td></tr>';
    } else {
      tbody.innerHTML = rows.map((r) => {
        const statusBadge = r.status === 'success' ? 'badge-success' : 'badge-critical';
        let meta = r.meta || '';
        try { if (typeof meta === 'string' && meta) meta = JSON.parse(meta); } catch (_) {}
        const metaStr = (typeof meta === 'object' && meta) ? JSON.stringify(meta) : (meta || '');
        const metaTrunc = metaStr.length > 80 ? metaStr.slice(0, 80) + '…' : metaStr;
        return '<tr class="hover:bg-brand/5 border-t border-white/5">' +
          '<td class="px-3 py-2 text-ink-muted text-xs whitespace-nowrap">' + escapeHtml(r.created_at || '—') + '</td>' +
          '<td class="px-3 py-2"><span class="badge badge-info font-mono text-[10px]">' + escapeHtml(r.action || '—') + '</span></td>' +
          '<td class="px-3 py-2 font-mono text-ink-muted text-xs">' + escapeHtml((r.actor_id || '—').slice(0, 8)) + '</td>' +
          '<td class="px-3 py-2 font-mono text-ink-muted text-xs">' + escapeHtml(r.actor_ip || '—') + '</td>' +
          '<td class="px-3 py-2"><span class="badge ' + statusBadge + '">' + escapeHtml(r.status || '—') + '</span></td>' +
          '<td class="px-3 py-2 font-mono text-ink-faint text-xs max-w-[260px] truncate" title="' + escapeHtml(metaStr) + '">' + escapeHtml(metaTrunc) + '</td>' +
        '</tr>';
      }).join('');
    }
    const p = $id('audit-pagination');
    if (p && pagination) {
      p.innerHTML = paginationFooter(pagination, () => { state.techAudit.page--; loadTechAudit(); }, () => { state.techAudit.page++; loadTechAudit(); }, { limit: state.techAudit.limit });
      bindPagination('#audit-pagination', () => { state.techAudit.page--; loadTechAudit(); }, () => { state.techAudit.page++; loadTechAudit(); });
    }
  }

  // ── 4. TECH BACKUP ──
  function renderTechBackupView(root) {
    root.innerHTML =
      '<div class="space-y-4">' +
        '<h2 class="text-lg font-semibold text-white">Backup Operations</h2>' +
        // Info card
        '<div class="card p-5">' +
          '<h3 class="text-sm font-semibold text-white mb-3">Database Snapshot</h3>' +
          '<div id="tech-backup-info" class="space-y-2 text-xs text-ink-muted">' +
            '<div class="skeleton h-4 w-40"></div>'.repeat(3) +
          '</div>' +
          '<div class="mt-4">' +
            '<button class="btn btn-accent text-xs" data-act="download-backup">' + svg(ICONS.download, 'w-3.5 h-3.5') + ' Download DB Snapshot</button>' +
          '</div>' +
        '</div>' +
        // Recent backup audit log
        '<div class="card p-5">' +
          '<h3 class="text-sm font-semibold text-white mb-3">Recent Backup Activity</h3>' +
          '<div class="overflow-x-auto">' +
            '<table class="w-full text-xs">' +
              '<thead class="bg-surface-2 text-ink-faint">' +
                '<tr>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Time</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Action</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Status</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">IP</th>' +
                  '<th class="text-left px-3 py-2 font-semibold uppercase tracking-wider">Details</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody id="backup-audit-tbody"></tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</div>';
    $qs('[data-act="download-backup"]', root).addEventListener('click', () => openBackupPasscodeModal());
    loadTechBackupInfo();
    loadBackupAuditLog();
  }

  async function loadTechBackupInfo() {
    try {
      const body = await apiJson(API + '/admin/backup-db/info');
      const info = body && body.data ? body.data : {};
      const wrap = $id('tech-backup-info');
      if (!wrap) return;
      wrap.innerHTML =
        '<div class="flex justify-between"><span>Enabled</span><span class="font-mono text-white">' + (info.enabled ? 'Yes' : 'No') + '</span></div>' +
        '<div class="flex justify-between"><span>Database path</span><span class="font-mono text-white truncate ml-2" title="' + escapeHtml(info.db_path || '') + '">' + escapeHtml((info.db_path || '—').replace(/^.*\//, '')) + '</span></div>' +
        '<div class="flex justify-between"><span>Database size</span><span class="font-mono text-white">' + (info.db_size_bytes ? (info.db_size_bytes / 1024).toFixed(1) + ' KB' : '—') + '</span></div>' +
        '<div class="flex justify-between"><span>Rate limit</span><span class="font-mono text-white">' + (info.rate_limit_max || 3) + ' downloads per ' + Math.round((info.rate_limit_window_ms || 900000) / 60000) + ' min</span></div>';
    } catch (_) { /* silent — the info card stays as skeleton */ }
  }

  async function loadBackupAuditLog() {
    const tbody = $id('backup-audit-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-ink-muted">Loading…</td></tr>';
    try {
      const body = await apiJson(API + '/admin/audit-logs?limit=20&page=1');
      const all = (body && body.data) || [];
      // Client-side filter: only backup-related actions
      const backupLogs = all.filter((r) => /BACKUP_DOWNLOAD/.test(r.action || ''));
      if (!backupLogs.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-ink-muted">' + emptyState('No backup activity yet.', svg(ICONS.backup, 'w-8 h-8 text-ink-faint')) + '</td></tr>';
        return;
      }
      tbody.innerHTML = backupLogs.map((r) => {
        const ok = r.status === 'success';
        let meta = r.meta || '';
        try { if (typeof meta === 'string' && meta) meta = JSON.parse(meta); } catch (_) {}
        let detail = '';
        if (meta && typeof meta === 'object') {
          if (meta.reason) detail = meta.reason;
          else if (meta.file) detail = meta.file + (meta.size ? ' (' + meta.size + ' bytes)' : '');
          else detail = JSON.stringify(meta);
        }
        return '<tr class="hover:bg-brand/5 border-t border-white/5">' +
          '<td class="px-3 py-2 text-ink-muted text-xs whitespace-nowrap">' + escapeHtml(r.created_at || '—') + '</td>' +
          '<td class="px-3 py-2"><span class="badge ' + (ok ? 'badge-success' : 'badge-critical') + ' font-mono text-[10px]">' + escapeHtml(r.action) + '</span></td>' +
          '<td class="px-3 py-2"><span class="badge ' + (ok ? 'badge-success' : 'badge-critical') + '">' + escapeHtml(r.status) + '</span></td>' +
          '<td class="px-3 py-2 font-mono text-ink-muted text-xs">' + escapeHtml(r.actor_ip || '—') + '</td>' +
          '<td class="px-3 py-2 font-mono text-ink-faint text-xs">' + escapeHtml(detail) + '</td>' +
        '</tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-rose-400">Error: ' + escapeHtml(err.message || String(err)) + '</td></tr>';
    }
  }

  /* =========================================================
   * Polling: backend health + unread alerts count
   * ========================================================= */
  async function pollHealth() {
    const dot = $id('backend-dot');
    const txt = $id('backend-status-text');
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('/health', { signal: ctrl.signal, credentials: 'same-origin' });
      clearTimeout(to);
      if (res.ok) {
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
        if (txt) txt.textContent = 'Backend online';
        state.backendStatus = 'online';
      } else {
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400';
        if (txt) txt.textContent = 'Backend ' + res.status;
        state.backendStatus = 'degraded';
      }
    } catch (_) {
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-rose-400';
      if (txt) txt.textContent = 'Backend unreachable';
      state.backendStatus = 'offline';
    }
  }
  async function pollAlerts() {
    try {
      const body = await apiJson(API + '/admin/alerts/unread-count');
      const data = (body && body.data) || {};
      const n = Number(data.count !== undefined ? data.count : (data.unread_count || 0));
      state.unreadAlerts = n;
      updateNotifBadge();
    } catch (err) {
      if (err && err.auth) return;
      // silent — poll again next cycle
    }
  }

  /* =========================================================
   * Logout
   * ========================================================= */
  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem(MODE_KEY);
    if (state.healthTimer) clearInterval(state.healthTimer);
    if (state.alertTimer) clearInterval(state.alertTimer);
    window.location.href = 'login.html';
  }

  /* =========================================================
   * Mobile sidebar drawer
   * ========================================================= */
  function openSidebarMobile() {
    const sb = $id('app-sidebar');
    const ov = $id('sidebar-overlay');
    if (!sb || !ov) return;
    sb.classList.remove('-translate-x-full');
    state.sidebarOpen = true;
    ov.classList.remove('hidden');
    $id('sidebar-toggle').setAttribute('aria-expanded', 'true');
  }
  function closeSidebarMobile() {
    const sb = $id('app-sidebar');
    const ov = $id('sidebar-overlay');
    if (!sb || !ov) return;
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    sb.classList.add('-translate-x-full');
    state.sidebarOpen = false;
    ov.classList.add('hidden');
    $id('sidebar-toggle').setAttribute('aria-expanded', 'false');
  }

  /* =========================================================
   * Global bindings
   * ========================================================= */
  function bindGlobal() {
    // Sidebar toggle (mobile)
    $id('sidebar-toggle').addEventListener('click', () => {
      if (state.sidebarOpen) closeSidebarMobile(); else openSidebarMobile();
    });
    $id('sidebar-overlay').addEventListener('click', closeSidebarMobile);
    $id('logout-btn').addEventListener('click', logout);

    // Mode toggle
    $qsa('#mode-toggle .mode-seg').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

    // Notification bell → alerts view
    $id('notif-bell').addEventListener('click', () => setView('alerts'));

    // User chip dropdown
    const chip = $id('user-chip');
    const menu = $id('user-menu');
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !menu.classList.contains('hidden');
      menu.classList.toggle('hidden', isOpen);
      chip.setAttribute('aria-expanded', String(!isOpen));
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#user-chip-wrap')) {
        menu.classList.add('hidden');
        chip.setAttribute('aria-expanded', 'false');
      }
    });
    $qsa('#user-menu [data-user-action]').forEach((b) => b.addEventListener('click', () => {
      const action = b.dataset.userAction;
      menu.classList.add('hidden');
      chip.setAttribute('aria-expanded', 'false');
      if (action === 'logout') logout();
      else if (action === 'profile') setView('profile');
      else if (action === 'password') {
        setView('profile');
        setTimeout(() => {
          const card = $id('password-card');
          if (card) {
            card.scrollIntoView({ behavior: 'smooth' });
            const inp = card.querySelector('input[name="current_password"]');
            if (inp) inp.focus();
          }
        }, 200);
      }
    }));

    // Global search (⌘K / Ctrl+K)
    const search = $id('global-search');
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (search) search.focus();
      }
      if (e.key === 'Escape') {
        if (modalState.open) { closeModal(); }
        else if (state.sidebarOpen) closeSidebarMobile();
      }
    });
    if (search) {
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          state.patients.search = search.value.trim();
          setView('patients');
        }
      });
    }

    // Modal backdrop + close button
    $id('modal-backdrop').addEventListener('click', closeModal);
    $id('modal-close').addEventListener('click', closeModal);
  }

  /* =========================================================
   * Init
   * ========================================================= */
  function init() {
    // Auth guard already ran in <head>. Re-check defensively.
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { window.location.replace('login.html'); return; }
    setToken(token);
    loadStoredUser();

    // Restore mode
    const savedMode = localStorage.getItem(MODE_KEY);
    if (savedMode === 'technical' || savedMode === 'clinical') state.mode = savedMode;
    // Sync segmented control
    $qsa('#mode-toggle .mode-seg').forEach((b) => {
      const active = b.dataset.mode === state.mode;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });

    // Initial render
    renderSidebar();
    renderUserChip();
    updateNotifBadge();
    bindGlobal();

    // Boot the first view
    setView(state.mode === 'technical' ? NAV_TECHNICAL[0].id : NAV_CLINICAL[0].id);

    // Start polling
    pollHealth();
    pollAlerts();
    state.healthTimer = setInterval(pollHealth, HEALTH_INTERVAL_MS);
    state.alertTimer = setInterval(pollAlerts, ALERT_POLL_INTERVAL_MS);
  }

  // Boot when DOM is ready.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
