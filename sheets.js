// CRUD against the user's resolved Google Sheet.
// Columns A..S map to the schema in build_plan.md.
(function () {
  const RANGE = 'places!A2:S';
  const WRITE_RANGE = 'places!A:S';

  // Map row -> place object.
  function rowToPlace(row) {
    return {
      id: row[0] || '',
      name: row[1] || '',
      address: row[2] || '',
      city: row[3] || '',
      state: row[4] || '',
      country: row[5] || '',
      neighborhood: row[6] || '',
      lat: row[7] ? Number(row[7]) : null,
      lng: row[8] ? Number(row[8]) : null,
      tags: U.parseTags(row[9]),
      notes: row[10] || '',
      visited: U.parseBool(row[11]),
      visited_date: row[12] || '',
      source_url: row[13] || '',
      place_id: row[14] || '',
      photo_reference: row[15] || '',
      price_tier: row[16] ? Number(row[16]) : null,
      added_date: row[17] || '',
      custom: row[18] || '',
    };
  }

  function placeToRow(p) {
    return [
      p.id,
      p.name,
      p.address || '',
      p.city || '',
      p.state || '',
      p.country || '',
      p.neighborhood || '',
      p.lat != null ? String(p.lat) : '',
      p.lng != null ? String(p.lng) : '',
      U.joinTags(p.tags),
      p.notes || '',
      U.boolOut(p.visited),
      p.visited_date || '',
      p.source_url || '',
      p.place_id || '',
      p.photo_reference || '',
      p.price_tier != null ? String(p.price_tier) : '',
      p.added_date || U.today(),
      p.custom || '',
    ];
  }

  async function listPlaces(sheetId) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(RANGE)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
    const res = await Auth.authedFetch(url);
    if (!res.ok) throw new Error(`sheets list ${res.status}`);
    const body = await res.json();
    return (body.values || []).filter((r) => r && r[0]).map(rowToPlace);
  }

  async function appendPlace(sheetId, place) {
    if (!place.id) place.id = U.uuid();
    if (!place.added_date) place.added_date = U.today();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(WRITE_RANGE)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await Auth.authedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [placeToRow(place)] }),
    });
    if (!res.ok) throw new Error(`sheets append ${res.status}`);
    return place;
  }

  // Find 0-based row index among the current values (ignoring header).
  async function findRowIndex(sheetId, id) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/places!A2:A?majorDimension=COLUMNS`;
    const res = await Auth.authedFetch(url);
    if (!res.ok) throw new Error(`sheets find ${res.status}`);
    const body = await res.json();
    const col = (body.values && body.values[0]) || [];
    const idx = col.indexOf(id);
    return idx === -1 ? null : idx; // 0 means row 2 in the sheet
  }

  async function updatePlace(sheetId, place) {
    const idx = await findRowIndex(sheetId, place.id);
    if (idx == null) throw new Error('row not found');
    const sheetRow = idx + 2; // data starts at row 2
    const range = `places!A${sheetRow}:S${sheetRow}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const res = await Auth.authedFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [placeToRow(place)] }),
    });
    if (!res.ok) throw new Error(`sheets update ${res.status}`);
    return place;
  }

  async function getSheetTabId(sheetId) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title))`;
    const res = await Auth.authedFetch(url);
    if (!res.ok) throw new Error(`sheets meta ${res.status}`);
    const body = await res.json();
    const tab = (body.sheets || []).find((s) => s.properties.title === 'places');
    return tab ? tab.properties.sheetId : 0;
  }

  async function deletePlace(sheetId, id) {
    const idx = await findRowIndex(sheetId, id);
    if (idx == null) throw new Error('row not found');
    const tabId = await getSheetTabId(sheetId);
    const startIndex = idx + 1; // +1 to skip header, 0-indexed rows for deleteDimension
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
    const res = await Auth.authedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: tabId,
                dimension: 'ROWS',
                startIndex,
                endIndex: startIndex + 1,
              },
            },
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`sheets delete ${res.status}`);
    return true;
  }

  window.Sheets = { listPlaces, appendPlace, updatePlace, deletePlace, rowToPlace, placeToRow };
})();
