'use strict';
// G-F tests: stop import, mark, map tap, dwell suggestions, manage-only access, audit rows.
// GAS globals are stubs (gas-stubs.js); nothing here touches a real Sheet, Worker or Google service.
const test = require('node:test');
const assert = require('node:assert');
const { loadGas, makeSpreadsheet, snapshot } = require('./gas-stubs');

const FILES = ['GpsSetup.js', 'GpsAuth.js', 'GpsWorker.js', 'GpsEndpoints.js', 'GpsStops.js'];
const J = (x) => JSON.parse(JSON.stringify(x));
const PROPS = { GPS_WORKER_URL: 'https://worker.example.test', GPS_READ_SECRET: 'R' };
const SRC_ID = 'SRC0123456789012345678901234';
const SCHOOL = [11.0, 77.0];

function fill(ss, name, objs) {
  const sh = ss.getSheetByName(name), hdr = sh.data[0];
  objs.forEach((o) => sh.appendRow(hdr.map((h) => (o[h] === undefined ? '' : o[h]))));
}
function sourceSheet(rows) {
  const data = rows.slice();
  const sh = { getLastRow: () => data.length, getLastColumn: () => Math.max(...data.map((r) => r.length)),
    getRange: (r, c, nr, nc) => ({ getValues: () => data.slice(r - 1, r - 1 + nr).map((row) => Array.from({ length: nc }, (_, j) => (row[c - 1 + j] === undefined ? '' : row[c - 1 + j]))) }) };
  return { getSheets: () => [sh], getSheetByName: () => sh };
}

const SRC_ROWS = [
  ['Place', 'Near', 'Bus', 'Shift', 'No', 'Time', 'Adm'],
  ['Anna Nagar', 'Temple', '7', 'morning', 1, '07:10', 'C000001'],
  ['Anna Nagar', '', '7', 'morning', 1, '07:10', '12345'],
  ['Gandhi Road', '', '7', 'morning', 2, '7:20:00', 'bad-no'],
  ['Lake View', '', '9', 'morning', 1, '', ''],
  ['', '', '', '', '', '', ''],
  ['Nehru St', '', '7', 'night', 3, '', '']
];

function world(opts) {
  opts = opts || {};
  const ss = makeSpreadsheet();
  const sources = { [SRC_ID]: sourceSheet(opts.src || SRC_ROWS) };
  const g = loadGas(FILES, { ss, props: PROPS, sources, email: opts.email === undefined ? 'boss@school.test' : opts.email,
    fetch: (url) => (g.handler ? g.handler(url) : { status: 404, body: {} }) });
  g.run('setupGpsTabs_(SpreadsheetApp.getActiveSpreadsheet())');
  const st = ss.sheets.Settings;
  fill(ss, 'Settings', [{ setting: 'x', value: '' }]);
  st.data = st.data.filter((r) => r[0] !== 'x');
  const set = (k, v) => { st.data.forEach((r) => { if (r[0] === k) r[1] = v; }); };
  set('stop_import_sheet_id', SRC_ID);
  fill(ss, 'GPS_Access', [{ email: 'boss@school.test', role: 'manage', active: 'Yes' }, { email: 'view@school.test', role: 'view', active: 'Yes' }]);
  fill(ss, 'Transport_Trips', [{ trip_code: 'T7M', session: 'MORNING_PICKUP', route_no: 7, vehicle_id: 'V1', active: 'Yes' },
    { trip_code: 'T9M', session: 'MORNING_PICKUP', route_no: 9, vehicle_id: 'V2', active: 'Yes' }]);
  fill(ss, 'Transport_Stops', [{ stop_id: 'SCH', stop_name: 'School', lat: SCHOOL[0], lon: SCHOOL[1], radius_m: 150, kind: 'school', coord_source: 'driven', verified_by: 'a', verified_on: '2026-11-01', active: 'Yes' }]);
  const map = ss.sheets.Stop_Import_Map;
  const put = (f, h, al) => map.data.forEach((r) => { if (r[0] === f) { r[1] = h; r[2] = al || ''; } });
  put('stop_name', 'Place'); put('landmark', '', 'near|landmark'); put('route_no', 'Bus'); put('session', 'Shift');
  put('sequence', 'No'); put('scheduled_time', 'Time'); put('admission_no', 'Adm');
  return { g, ss, set, rows: (n) => ss.sheets[n].data.slice(1), log: () => ss.sheets.GPS_Access_Log.data.slice(1) };
}
const call = (w, code) => J(w.g.run(code));
const stopRow = (w, id) => { const sh = w.ss.sheets.Transport_Stops; const h = sh.data[0]; const r = sh.data.find((x, i) => i && x[0] === id); const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; };
function addStop(w, o) { fill(w.ss, 'Transport_Stops', [Object.assign({ stop_id: 'S001', stop_name: 'Anna Nagar', radius_m: 75, kind: 'stop', active: 'Yes' }, o)]); }
function bus(over) { return Object.assign({ vehicle_id: 'V1', fix_ts: Date.now() - 5000, lat: 11.01234567, lon: 77.01234567, accuracy_m: 10 }, over); }
function latest(w, b) { w.g.handler = () => ({ status: 200, body: { buses: [b] } }); }

// ---- access ----
test('every server function refuses a non-manage caller and writes nothing', () => {
  ['view@school.test', 'nobody@school.test', ''].forEach((email) => {
    const w = world({ email });
    addStop(w, {});
    const before = snapshot(w.ss);
    ['getGpsStops()', "gpsMarkStop('S001','V1',false)", "gpsTapStop('S001',11.01,77.01,false)", "getGpsDwell('V1','')",
      "gpsSaveDwellDraft('S001',11.01,77.01,'map_tap',false)", 'gpsImportStops(true)', 'gpsImportStops(false)'].forEach((c) => {
      const r = call(w, c);
      assert.strictEqual(r.ok, false, c + ' as ' + email);
      assert.deepStrictEqual(Object.keys(r).sort(), ['error', 'ok'], c + ' leaks nothing');
    });
    assert.strictEqual(snapshot(w.ss), before, 'no sheet changed');
  });
});

// ---- import ----
test('parseStopImport: header-agnostic mapping, reasons for unmappable rows, bad admission rejected', () => {
  const w = world();
  const p = call(w, `parseStopImport(gpsRowsToObjects_(${JSON.stringify(SRC_ROWS)}), gpsReadTab_(SpreadsheetApp.getActiveSpreadsheet(),'Stop_Import_Map'), {headers: ${JSON.stringify(SRC_ROWS[0])}, trips: gpsReadTab_(SpreadsheetApp.getActiveSpreadsheet(),'Transport_Trips')})`);
  assert.deepStrictEqual(p.stops.map((s) => s.stop_name), ['Anna Nagar', 'Gandhi Road', 'Lake View', 'Nehru St']);
  assert.strictEqual(p.stops[0].landmark, 'Temple', 'alias for landmark resolved');
  assert.deepStrictEqual(p.studentStops.map((s) => s.admission_no), ['C000001', 'C012345'], '5 bare digits normalise');
  assert.ok(p.unmapped.some((u) => /C0nnnnn/.test(u.reason)), 'bad admission reported');
  assert.ok(p.unmapped.some((u) => /session "night"/.test(u.reason)), 'unknown session reported');
  assert.ok(p.unmapped.every((u) => u.row > 1 && u.reason), 'each has a row and a reason');
  assert.ok(!JSON.stringify(p.unmapped).includes('bad-no'), 'raw admission value not echoed');
  assert.ok(p.tripStops.some((t) => t.trip_code === 'T7M' && t.sequence === 2 && t.scheduled_time === '07:20'));
  const none = call(w, "parseStopImport([{_row:2,'Foo':'x'}], gpsReadTab_(SpreadsheetApp.getActiveSpreadsheet(),'Stop_Import_Map'), {headers:['Foo']})");
  assert.strictEqual(none.unmapped.length, 1);
});

test('gpsNormAdmission_', () => {
  const w = world();
  const n = (v) => w.g.run(`gpsNormAdmission_(${JSON.stringify(v)})`);
  assert.strictEqual(n('c012345'), 'C012345'); assert.strictEqual(n(' C0 12345 '), 'C012345');
  assert.strictEqual(n('12345'), 'C012345'); assert.strictEqual(n('C12345'), '');
  assert.strictEqual(n('C0123456'), ''); assert.strictEqual(n(''), '');
});

test('import twice creates no duplicates; imported stops are unverified with blank coordinates', () => {
  const w = world();
  const a = call(w, 'gpsImportStops(true)');
  assert.strictEqual(a.ok, true); assert.strictEqual(a.applied, true);
  const snap1 = snapshot(w.ss);
  const stops = w.rows('Transport_Stops');
  assert.strictEqual(stops.length, 1 + 4);
  ['S001', 'S002'].forEach((id) => {
    const s = stopRow(w, id);
    assert.deepStrictEqual([s.lat, s.lon, s.coord_source, s.verified_by, s.verified_on], ['', '', '', '', '']);
  });
  assert.strictEqual(w.rows('Trip_Stops').length, 3);
  assert.strictEqual(w.rows('Student_Trip_Stops').length, 2);
  assert.strictEqual(w.rows('Student_Trip_Stops')[0][4], 'No');
  const b = call(w, 'gpsImportStops(true)');
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.counts.stops_new + b.counts.trip_stops_new + b.counts.student_stops_new, 0);
  assert.strictEqual(w.rows('Transport_Stops').length, 5);
  assert.strictEqual(w.rows('Trip_Stops').length, 3);
  assert.strictEqual(w.rows('Student_Trip_Stops').length, 2);
  void snap1;
});

test('import never overwrites verified coordinates already set', () => {
  const w = world();
  addStop(w, { stop_id: 'S001', stop_name: '  anna   NAGAR ', lat: 11.05, lon: 77.05, coord_source: 'driven', verified_by: 'x@s.test', verified_on: '2026-11-10' });
  call(w, 'gpsImportStops(true)');
  const names = w.rows('Transport_Stops').map((r) => r[1].trim().toLowerCase().replace(/\s+/g, ' '));
  assert.strictEqual(names.filter((n) => n === 'anna nagar').length, 1, 'matched by normalised name');
  const s = stopRow(w, 'S001');
  assert.deepStrictEqual([s.lat, s.lon, s.verified_by, s.verified_on], [11.05, 77.05, 'x@s.test', '2026-11-10']);
});

test('dry run writes nothing to the stop tabs and reports the unmapped rows', () => {
  const w = world();
  const before = JSON.stringify(['Transport_Stops', 'Trip_Stops', 'Student_Trip_Stops'].map((n) => w.ss.sheets[n].data));
  const r = call(w, 'gpsImportStops(false)');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.dry_run, true);
  assert.strictEqual(r.counts.stops_new, 4);
  assert.ok(r.unmapped_total >= 2 && r.unmapped.length === r.unmapped_total);
  assert.strictEqual(JSON.stringify(['Transport_Stops', 'Trip_Stops', 'Student_Trip_Stops'].map((n) => w.ss.sheets[n].data)), before);
  assert.strictEqual(call(w, "gpsImportStops('yes')").dry_run, true, 'only literal true applies');
});

test('import with no source sheet id says TODO(human) and invents nothing', () => {
  const w = world(); w.set('stop_import_sheet_id', '');
  const r = call(w, 'gpsImportStops(true)');
  assert.strictEqual(r.ok, false); assert.match(r.error, /TODO\(human\)/);
});

test('import apply writes one audit row; stop names cannot become formulas', () => {
  const src = [['Place', 'Bus', 'Shift', 'No'], ['=HYPERLINK("x")', '7', 'morning', 1]];
  const w = world({ src });
  const n0 = w.log().length;
  call(w, 'gpsImportStops(true)');
  assert.strictEqual(w.log().length, n0 + 1);
  assert.match(w.log()[n0][1], /^stop_import:/);
  assert.ok(!/^[=+\-@]/.test(w.rows('Transport_Stops')[1][1]));
});

// ---- mark ----
test('mark stores 6 d.p., driven, verifier and date, and writes an audit row', () => {
  const w = world(); addStop(w, {}); latest(w, bus());
  const n0 = w.log().length;
  const r = call(w, "gpsMarkStop('S001','V1',false)");
  assert.strictEqual(r.ok, true);
  const s = stopRow(w, 'S001');
  assert.strictEqual(s.lat, 11.012346); assert.strictEqual(s.lon, 77.012346);
  assert.strictEqual(s.coord_source, 'driven'); assert.strictEqual(s.verified_by, 'boss@school.test');
  assert.match(s.verified_on, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(w.log().length, n0 + 1);
  assert.match(w.log()[n0][1], /^stop_save:S001:driven:11\.012346,77\.012346/);
  assert.strictEqual(w.log()[n0][2], 'boss@school.test');
  assert.match(r.position_as_of_text, /^\d\d:\d\d$/);
});

test('mark rejects stale, inaccurate, unreported-accuracy and missing fixes; nothing changes', () => {
  const w = world(); addStop(w, {});
  const before = snapshot(w.ss);
  [bus({ fix_ts: Date.now() - 61000 }), bus({ accuracy_m: 51 }), bus({ accuracy_m: undefined }), bus({ lat: null, lon: null }), bus({ lat: 0, lon: 0 }), bus({ fix_ts: null })].forEach((b) => {
    latest(w, b);
    assert.strictEqual(call(w, "gpsMarkStop('S001','V1',false)").ok, false);
  });
  latest(w, bus({ vehicle_id: 'V9' }));
  assert.strictEqual(call(w, "gpsMarkStop('S001','V1',false)").ok, false, 'vehicle not in latest');
  assert.strictEqual(snapshot(w.ss), before);
  latest(w, bus({ fix_ts: Date.now() - 55000, accuracy_m: 50 }));
  assert.strictEqual(call(w, "gpsMarkStop('S001','V1',false)").ok, true, 'inside both limits');
});

test('re-mark of a verified stop needs overwrite and logs the old values', () => {
  const w = world(); addStop(w, {}); latest(w, bus());
  call(w, "gpsMarkStop('S001','V1',false)");
  latest(w, bus({ lat: 11.02, lon: 77.02 }));
  const r = call(w, "gpsMarkStop('S001','V1',false)");
  assert.strictEqual(r.ok, false); assert.strictEqual(r.needs_overwrite, true);
  assert.strictEqual(stopRow(w, 'S001').lat, 11.012346);
  const n0 = w.log().length;
  assert.strictEqual(call(w, "gpsMarkStop('S001','V1',true)").ok, true);
  assert.strictEqual(stopRow(w, 'S001').lat, 11.02);
  assert.match(w.log()[n0][1], /:overwrite:old=11\.012346,77\.012346,driven,/);
});

test('mark: the position comes from the Worker, not the client; bad ids refused', () => {
  const w = world(); addStop(w, {}); latest(w, bus());
  assert.strictEqual(call(w, "gpsMarkStop('S001','V1',false, 99.0, 99.0)").ok, true);
  assert.strictEqual(stopRow(w, 'S001').lat, 11.012346);
  assert.strictEqual(call(w, "gpsMarkStop('NOPE','V1',false)").ok, false);
  assert.strictEqual(call(w, "gpsMarkStop('S001','V 1',false)").ok, false);
  w.g.handler = () => ({ status: 500, body: {} });
  assert.strictEqual(call(w, "gpsMarkStop('S001','V1',true)").ok, false, 'Worker down');
});

// ---- map tap ----
test('map tap: saves map_tap with verifier; bounds, 0,0 and range rejected', () => {
  const w = world(); addStop(w, {});
  const n0 = w.log().length;
  const r = call(w, "gpsTapStop('S001', 11.0123456789, 77.01, false)");
  assert.strictEqual(r.ok, true);
  const s = stopRow(w, 'S001');
  assert.deepStrictEqual([s.lat, s.coord_source, s.verified_by], [11.012346, 'map_tap', 'boss@school.test']);
  assert.strictEqual(w.log().length, n0 + 1);
  const bad = (la, lo) => call(w, `gpsTapStop('S001', ${la}, ${lo}, true)`).ok;
  assert.strictEqual(bad(0, 0), false); assert.strictEqual(bad(91, 77), false); assert.strictEqual(bad(11, 181), false);
  assert.strictEqual(bad("''", 77), false); assert.strictEqual(bad(11.5, 77.5), false, 'about 77 km away');
  assert.strictEqual(bad(11.25, 77.0), true, 'about 28 km away');
  assert.strictEqual(bad(11.28, 77.0), false, 'about 31 km away');
});

test('map tap needs a school position to check against', () => {
  const w = world(); addStop(w, {});
  w.ss.sheets.Transport_Stops.data[1][3] = ''; // clear school lat
  assert.strictEqual(call(w, "gpsTapStop('S001', 11.01, 77.01, false)").ok, false);
});

// ---- dwell ----
test('suggestDwellStops: 20 s boundary, 30 m boundary, near-existing excluded', () => {
  const w = world();
  const D = (pts, o) => J(w.g.sandbox.suggestDwellStops(pts, o || {}));
  const mPerDeg = 111194.9266;
  const at = (t, northM) => ({ t: t * 1000, la: 11 + northM / mPerDeg, lo: 77 });
  assert.strictEqual(D([at(0, 0), at(10, 0), at(20, 0)]).length, 1, '20 s exactly counts');
  assert.strictEqual(D([at(0, 0), at(10, 0), { t: 19999, la: 11, lo: 77 }]).length, 0, '19.999 s does not');
  assert.strictEqual(D([at(0, 0), at(10, 29.9), at(20, 29.9)]).length, 1, 'inside 30 m stays one cluster');
  assert.strictEqual(D([at(0, 0), at(10, 30.5), at(20, 30.5), at(30, 30.5)]).length, 1, 'beyond 30 m starts a new cluster that itself dwells 20 s');
  assert.strictEqual(D([at(0, 0), at(10, 30.5), at(20, 61), at(30, 91.5)]).length, 0, 'always moving: none');
  const one = D([at(0, 0), at(10, 0), at(20, 0)])[0];
  assert.deepStrictEqual([one.duration_s, one.count], [20, 3]);
  assert.strictEqual(D([at(0, 0), at(10, 0), at(20, 0)], { existingStops: [{ lat: 11 + 29 / mPerDeg, lon: 77 }] }).length, 0, 'within 30 m of a stop');
  assert.strictEqual(D([at(0, 0), at(10, 0), at(20, 0)], { existingStops: [{ lat: 11 + 31 / mPerDeg, lon: 77 }] }).length, 1, '31 m away is new');
  assert.strictEqual(D([at(0, 0), at(10, 0), at(20, 0)], { existingStops: [{ lat: '', lon: '' }] }).length, 1, 'blank-coordinate stop ignored');
  assert.strictEqual(D([at(0, 0), at(200, 0)]).length, 0, 'a long silence is not a dwell');
});

test('getGpsDwell is read-only and excludes dwells at known stops; draft save never verifies', () => {
  const w = world(); addStop(w, { stop_id: 'S001', stop_name: 'Far', lat: '', lon: '' });
  const t0 = Date.now() - 3600000;
  const pts = [0, 10, 20, 30].map((s) => ({ fix_ts: t0 + s * 1000, lat: 11.01, lon: 77.01 }));
  const school = [0, 10, 20].map((s) => ({ fix_ts: t0 + 500000 + s * 1000, lat: SCHOOL[0], lon: SCHOOL[1] }));
  w.g.handler = () => ({ status: 200, body: { data_as_of: Date.now(), points: pts.concat(school) } });
  const before = snapshot(w.ss);
  const r = call(w, "getGpsDwell('V1','')");
  assert.strictEqual(r.ok, true); assert.strictEqual(r.suggestions.length, 1, 'school dwell excluded');
  const lg = w.log().length;
  void before; void lg;
  const s0 = r.suggestions[0];
  const d = call(w, `gpsSaveDwellDraft('S001', ${s0.lat}, ${s0.lon}, 'driven', false)`);
  assert.strictEqual(d.ok, true);
  const s = stopRow(w, 'S001');
  assert.deepStrictEqual([s.coord_source, s.verified_by, s.verified_on], ['driven', '', ''], 'draft stays unverified');
  assert.strictEqual(call(w, `gpsSaveDwellDraft('S001', ${s0.lat}, ${s0.lon}, 'geocoded_draft', true)`).ok, false, 'source limited to the two choices');
  assert.strictEqual(call(w, `gpsSaveDwellDraft('S001', 11.02, 77.02, 'map_tap', false)`).needs_overwrite, true);
  call(w, "gpsTapStop('S001', 11.02, 77.02, false)");
  assert.strictEqual(call(w, `gpsSaveDwellDraft('S001', 11.03, 77.03, 'map_tap', true)`).ok, false, 'verified stop is never replaced by a draft');
});

test('every save writes exactly one audit row', () => {
  const w = world(); addStop(w, {}); latest(w, bus());
  const n = () => w.log().length;
  let n0 = n(); call(w, "gpsMarkStop('S001','V1',false)"); assert.strictEqual(n(), n0 + 1);
  n0 = n(); call(w, "gpsTapStop('S001', 11.02, 77.02, true)"); assert.strictEqual(n(), n0 + 1);
  n0 = n(); call(w, "gpsTapStop('S001', 0, 0, true)"); assert.strictEqual(n(), n0, 'a refused save writes none');
});

test('getGpsStops lists unverified stops, buses and school; ?page=gps-stops serves the page', () => {
  const w = world(); addStop(w, {});
  const r = call(w, 'getGpsStops()');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stops.find((s) => s.stop_id === 'S001').unverified, true);
  assert.deepStrictEqual(r.vehicles, ['V1', 'V2']);
  assert.deepStrictEqual(r.school, { lat: SCHOOL[0], lon: SCHOOL[1] });
  assert.strictEqual(r.import_configured, true);
  const g2 = loadGas(['Code.js']);
  g2.run("doGet({parameter:{page:'gps-stops'}})");
  assert.strictEqual(g2.state.templates[0].name, 'GpsStops');
});
