// Google Identity Services (GIS) token flow + Drive sheet resolution.
(function () {
  const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
  ].join(' ');

  const TOKEN_KEY = 'pins_token';
  const TOKEN_EXP_KEY = 'pins_token_exp';
  const SHEET_KEY = 'pins_sheet_id';
  const EMAIL_KEY = 'pins_user_email';

  let tokenClient = null;

  function saveToken(resp) {
    const expiresAt = Date.now() + (resp.expires_in - 60) * 1000;
    sessionStorage.setItem(TOKEN_KEY, resp.access_token);
    sessionStorage.setItem(TOKEN_EXP_KEY, String(expiresAt));
  }

  function getToken() {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const exp = Number(sessionStorage.getItem(TOKEN_EXP_KEY) || 0);
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
      callback: () => {}, // overridden per-request
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
        client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      } catch (e) {
        reject(e);
      }
    });
  }

  function signOut() {
    const t = sessionStorage.getItem(TOKEN_KEY);
    if (t && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(t, () => {}); } catch (_) {}
    }
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXP_KEY);
    sessionStorage.removeItem(SHEET_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
  }

  // Drive: find the sheet whose name contains the configured prefix.
  async function resolveSheet() {
    const cached = sessionStorage.getItem(SHEET_KEY);
    if (cached) return cached;
    const token = getToken();
    if (!token) throw new Error('no-token');
    const prefix = (window.CONFIG.SHEET_NAME_PREFIX || 'PlaceTracker').replace(/'/g, "\\'");
    const q = `name contains '${prefix}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const url =
      'https://www.googleapis.com/drive/v3/files?fields=' +
      encodeURIComponent('files(id,name,modifiedTime,owners(emailAddress))') +
      '&pageSize=10&orderBy=modifiedTime desc&q=' +
      encodeURIComponent(q);
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error(`drive ${res.status}`);
    const body = await res.json();
    const files = body.files || [];
    if (!files.length) return null;
    const pick = files[0];
    sessionStorage.setItem(SHEET_KEY, pick.id);
    return pick.id;
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

  window.Auth = { signIn, signOut, getToken, resolveSheet, authedFetch };
})();
