// Google Identity Services (GIS) token flow + userinfo + minimal Drive lookup.
//
// Scopes are intentionally tight: drive.file only. That means this app can
// only see files it *created* (admin path) or files the user *opened* via
// Google Picker (friend path). Nothing else.
(function () {
  // Scopes:
  //   spreadsheets — read/write any sheet the user has access to. Broader
  //     than drive.file alone but the only reliable way for friends to read
  //     sheets admin has shared with them, since Picker-based drive.file
  //     grant-recording is inconsistent in practice.
  //   drive.file   — create sheets (admin) + manage permissions on them.
  //   openid + email — identify the signed-in user.
  const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'openid',
    'email',
  ].join(' ');

  // Both the token and sheet id persist in localStorage across sessions.
  const TOKEN_KEY = 'pins_token';
  const TOKEN_EXP_KEY = 'pins_token_exp';
  const EMAIL_KEY = 'pins_user_email';
  // Persisted email for login_hint — avoids account-picker on re-auth.
  const EMAIL_LS_KEY = 'pins_user_email_ls';
  const SHEET_KEY = 'pins_sheet_id';

  let tokenClient = null;

  function saveToken(resp) {
    const expiresAt = Date.now() + (resp.expires_in - 60) * 1000;
    // localStorage instead of sessionStorage so the token survives iOS PWA
    // relaunches (iOS wipes sessionStorage every time the app is closed).
    // Access tokens expire after ~1 hour regardless, so the persistence window
    // is short and the XSS exposure is identical to sessionStorage.
    localStorage.setItem(TOKEN_KEY, resp.access_token);
    localStorage.setItem(TOKEN_EXP_KEY, String(expiresAt));
  }

  function getToken() {
    const t = localStorage.getItem(TOKEN_KEY);
    const exp = Number(localStorage.getItem(TOKEN_EXP_KEY) || 0);
    if (!t || Date.now() > exp) return null;
    return t;
  }

  function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      throw new Error('GIS not loaded yet');
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.CONFIG.CLIENT_ID,
      scope: SCOPES,
      prompt: '',
      callback: () => {},
    });
    return tokenClient;
  }

  async function signIn({ interactive = true } = {}) {
    return new Promise((resolve, reject) => {
      try {
        const client = ensureTokenClient();
        client.callback = (resp) => {
          if (resp.error) return reject(resp);
          saveToken(resp);
          resolve(resp);
        };
        client.error_callback = (err) => reject(err);
        // Never force prompt:'consent' after the first grant — it makes Google
        // show the full permissions screen on every re-auth. Empty prompt lets
        // Google silently reuse an active session, or at worst show a one-tap
        // "Continue as you" button. login_hint pre-selects the account so even
        // the account-picker step is skipped.
        const hint = localStorage.getItem(EMAIL_LS_KEY) || '';
        client.requestAccessToken({ prompt: '', login_hint: hint });
      } catch (e) {
        reject(e);
      }
    });
  }

  function signOut() {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(t, () => {}); } catch (_) {}
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXP_KEY);
    localStorage.removeItem(EMAIL_LS_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
    // Note: we intentionally do NOT clear the saved sheet id on sign-out —
    // if the same user signs back in on this device, we want to skip Picker.
  }

  async function getUserEmail() {
    const cached = sessionStorage.getItem(EMAIL_KEY);
    if (cached) return cached;
    const res = await authedFetch('https://openidconnect.googleapis.com/v1/userinfo');
    if (!res.ok) throw new Error(`userinfo ${res.status}`);
    const body = await res.json();
    const email = (body.email || '').toLowerCase();
    if (email) {
      sessionStorage.setItem(EMAIL_KEY, email);
      localStorage.setItem(EMAIL_LS_KEY, email);
    }
    return email;
  }

  // Sheet id cache is keyed by email so signing in with a different account
  // on the same device doesn't inherit the previous user's sheet id.
  function sheetKeyFor(email) {
    return email ? `${SHEET_KEY}:${email.toLowerCase()}` : SHEET_KEY;
  }

  function getSavedSheetId(email) {
    if (email) {
      const byEmail = localStorage.getItem(sheetKeyFor(email));
      if (byEmail) return byEmail;
    }
    // Legacy flat key — fall back for users who set up before email-keying.
    return localStorage.getItem(SHEET_KEY);
  }

  function saveSheetId(id, email) {
    if (!id) return;
    localStorage.setItem(sheetKeyFor(email), id);
    // Clear legacy key so it doesn't mask the fresh email-keyed one later.
    localStorage.removeItem(SHEET_KEY);
  }

  function clearSavedSheetId(email) {
    if (email) localStorage.removeItem(sheetKeyFor(email));
    localStorage.removeItem(SHEET_KEY);
  }

  // Nuke everything local (sheet ids, tokens, labels). Used by the "Reset app
  // data" button in Settings.
  function clearAllLocalData() {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('pins_'))
      .forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem(EMAIL_KEY);
  }

  // Drive list restricted to files this app (OAuth client) has created or this
  // user has opened via Picker. Admin sees all sheets they provisioned; a
  // friend sees only the one they've confirmed via Picker.
  async function listAppSheets() {
    const prefix = (window.CONFIG.SHEET_NAME_PREFIX || 'PlaceTracker').replace(/'/g, "\\'");
    const q = `name contains '${prefix}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const url =
      'https://www.googleapis.com/drive/v3/files?fields=' +
      encodeURIComponent('files(id,name,modifiedTime)') +
      '&pageSize=50&orderBy=modifiedTime desc&q=' +
      encodeURIComponent(q);
    const res = await authedFetch(url);
    if (!res.ok) throw new Error(`drive ${res.status}`);
    const body = await res.json();
    return body.files || [];
  }

  function isAdmin(email) {
    const admin = (window.CONFIG.ADMIN_CONTACT || '').toLowerCase();
    return !!admin && email && email.toLowerCase() === admin;
  }

  async function authedFetch(url, opts = {}) {
    let token = getToken();
    if (!token) {
      await signIn({ interactive: false });
      token = getToken();
    }
    const headers = Object.assign({}, opts.headers || {}, {
      Authorization: 'Bearer ' + token,
    });
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      await signIn({ interactive: true });
      token = getToken();
      headers.Authorization = 'Bearer ' + token;
      return fetch(url, Object.assign({}, opts, { headers }));
    }
    return res;
  }

  function hasPreviouslyAuthed() {
    // A stored token key (even expired) means this device has signed in before,
    // so it's worth attempting silent re-auth before showing the sign-in screen.
    return !!localStorage.getItem(TOKEN_KEY);
  }

  window.Auth = {
    signIn, signOut, getToken, getUserEmail, hasPreviouslyAuthed,
    getSavedSheetId, saveSheetId, clearSavedSheetId, clearAllLocalData,
    listAppSheets, isAdmin, authedFetch,
  };
})();
