// Google Picker — the mechanism that "opens" a Drive file into the drive.file
// scope. Non-admin users need this once, on their first sign-in on a device,
// to confirm which sheet the app should access. After that, Google remembers
// the per-file grant and the app can read/write via the Sheets API forever.
(function () {
  const PICKER_SRC = 'https://apis.google.com/js/api.js';
  let gapiLoading = null;
  let pickerLoaded = false;

  function loadGapi() {
    if (gapiLoading) return gapiLoading;
    gapiLoading = new Promise((resolve, reject) => {
      if (window.gapi) return resolve();
      const s = document.createElement('script');
      s.src = PICKER_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('failed to load gapi'));
      document.head.appendChild(s);
    });
    return gapiLoading;
  }

  async function loadPickerModule() {
    await loadGapi();
    if (pickerLoaded) return;
    await new Promise((resolve, reject) => {
      gapi.load('picker', { callback: resolve, onerror: reject });
    });
    pickerLoaded = true;
  }

  // Extract the project number (prefix before the dash) from a Client ID
  // like "502811448040-xxxxxx.apps.googleusercontent.com". Picker needs this
  // as `appId` to record the per-file drive.file grant when the user picks
  // a file. Without setAppId, Picker happily returns a file id but the
  // Sheets API will 404 on subsequent reads because the grant was never
  // associated with this app.
  function appIdFromClientId(clientId) {
    if (!clientId) return '';
    const dash = clientId.indexOf('-');
    return dash > 0 ? clientId.slice(0, dash) : '';
  }

  // Show Picker filtered to spreadsheets matching our naming prefix. Resolves
  // with the selected file id, or rejects on cancel.
  async function pickSheet({ title = 'Select your Pins notebook' } = {}) {
    await loadPickerModule();
    const token = Auth.getToken();
    if (!token) throw new Error('not signed in');
    const prefix = window.CONFIG.SHEET_NAME_PREFIX || 'PlaceTracker';
    const appId = appIdFromClientId(window.CONFIG.CLIENT_ID);
    return new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS);
      view.setMimeTypes('application/vnd.google-apps.spreadsheet');
      view.setMode(google.picker.DocsViewMode.LIST);
      view.setIncludeFolders(false);
      view.setSelectFolderEnabled(false);
      if (prefix && view.setQuery) view.setQuery(prefix);
      const builder = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(window.CONFIG.API_KEY)
        .setTitle(title)
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const file = data.docs && data.docs[0];
            if (file && file.id) resolve(file.id);
            else reject(new Error('no file selected'));
          } else if (data.action === google.picker.Action.CANCEL) {
            reject(new Error('cancelled'));
          }
        });
      if (appId) builder.setAppId(appId);
      const picker = builder.build();
      picker.setVisible(true);
    });
  }

  window.Picker = { pickSheet };
})();
