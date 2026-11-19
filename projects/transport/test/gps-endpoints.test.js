'use strict';
// G-B tests: R14 refusals, R17 cache, R13 Worker-down fallback, R18 access log,
// R20 config payload, R21 token handling. GAS globals are stubs (see gas-stubs.js);
// nothing here talks to a real Worker, Sheet or Google service.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { loadGas, makeSpreadsheet } = require('./gas-stubs');

const FILES = ['GpsSetup.js', 'GpsAuth.js', 'GpsWorker.js', 'GpsEndpoints.js'];
const J = (x) => JSON.parse(JSON.stringify(x));
const URL_BASE = 'https://worker.example.test';
const PROPS = { GPS_WORKER_URL: URL_BASE, GPS_READ_SECRET: 'READ-SECRET-VALUE', GPS_CONFIG_SECRET: 'CONFIG-SECRET-VALUE' };
const NOW = Date.now();
const TODAY = (() => { const d = new Date(NOW + 330 * 60000); return d.toISOString().slice(0, 10); })();
const TOKEN = 'TOKENabcdefghijklmnopqrstuvwxyz0123';

function fill(ss, name, objs) {
  const sh = ss.getSheetByName(name);
  const hdr = sh.data[0];
  objs.forEach((o) => sh.appendRow(hdr.map((h) => (o[h] === undefined ? '' : o[h]))));
}

function latestBody() {
  const st = (state, icon) => ({ state, icon, text: state });
  return {
    now: NOW, data_as_of: NOW - 60000,
    buses: [
      { vehicle_id: 'V1', device_id: 'D1', status: st('Live', '✓'), fix_ts: NOW - 60000, recv_ts: NOW - 60000, lat: 11.0, lon: 78.0, speed_kmh: 30, battery_pct: 80, late: false },
      { vehicle_id: 'V2', device_id: 'D2', status: st('Error', '⚠'), fix_ts: NOW - 900000, recv_ts: NOW - 900000, lat: 11.1, lon: 78.1, speed_kmh: 0, battery_pct: 10, late: false },
      { vehicle_id: 'V3', device_id: 'D3', status: st('Stale', '⌛'), fix_ts: NOW - 700000, recv_ts: NOW - 700000, lat: 11.2, lon: 78.2, speed_kmh: 0, battery_pct: 50, late: false },
      { vehicle_id: 'V4', device_id: 'D4', status: st('Pending', '⏳'), fix_ts: null, recv_ts: null, lat: null, lon: null, speed_kmh: null, battery_pct: null, late: null }
    ]
  };
}

/** A workbook with GPS tabs set up, one manager, one viewer, one inactive manager. */
function world(opts) {
  opts = opts || {};
  const ss = makeSpreadsheet();
  const st = ss.insertSheet('Settings');
  st.data = [['setting', 'value', 'notes'], ['gps_enabled', opts.enabled || 'Yes', ''], ['gps_stale_minutes', '5', '']];
  const requests = { n: 0 };
  const g = loadGas(FILES, {
    ss, props: PROPS, email: '',
    fetch: (url, o) => {
      requests.n++;
      if (g.handler) return g.handler(url, o);
      const u = new URL(url);
      if (u.pathname === '/v1/latest') return { status: 200, body: latestBody() };
      if (u.pathname === '/v1/track') {
        const t0 = NOW - 3600000;
        const pts = [0, 30, 60, 90, 450, 480, 510].map((s, i) => ({ fix_ts: t0 + s * 1000, lat: 11 + i * 0.001, lon: 78 + i * 0.001, speed_kmh: 20 }));
        return { status: 200, body: { data_as_of: NOW - 1000, vehicle_id: 'V1', date: TODAY, points: pts } };
      }
      if (u.pathname === '/v1/daily') return { status: 200, body: { data_as_of: NOW - 1000, date: TODAY, rows: [{ vehicle_id: 'V1', trip_code: 'T1', session: 'MORNING_PICKUP', pings: 100, late_pings: 2, first_fix_ts: NOW - 7200000, last_fix_ts: NOW - 60000, summary: { a: 1 } }] } };
      if (u.pathname === '/v1/admin/config') return { status: 200, body: { ok: true, changed: true, version: 3, content_hash: JSON.parse(o.payload).content_hash } };
      if (u.pathname === '/v1/admin/tokens/issue') return { status: 200, body: { ok: true, device_id: 'D1', token: TOKEN, token_last4: TOKEN.slice(-4), url: URL_BASE + '/v1/osmand/' + TOKEN } };
      if (u.pathname === '/v1/admin/tokens/revoke') return { status: 200, body: { ok: true, device_id: 'D1', status: 'revoked' } };
      return { status: 404, body: {} };
    }
  });
  g.requests = requests;
  g.sandbox.setupGpsTabs_(ss);
  fill(ss, 'GPS_Access', [
    { email: 'boss@school.test', role: 'manage', active: 'Yes' },
    { email: 'view@school.test', role: 'view', active: 'Yes' },
    { email: 'gone@school.test', role: 'manage', active: 'No' }
  ]);
  fill(ss, 'GPS_Devices', [
    { device_id: 'D1', vehicle_id: 'V1', kind: 'phone', store_outside_window: 'No', status: 'Live' },
    { device_id: 'D2', vehicle_id: 'V2', kind: 'hardwired', store_outside_window: 'Yes', active_to: '2000-01-01' }
  ]);
  fill(ss, 'Transport_Trips', [{ trip_code: 'T1', session: 'MORNING_PICKUP', route_no: 'R1', vehicle_id: 'V1', window_start: '00:00', window_end: '23:59', active: 'Yes' }]);
  fill(ss, 'Transport_Stops', [
    { stop_id: 'S1', stop_name: 'Gate', lat: 11.0, lon: 78.0, radius_m: 100, kind: 'stop', active: 'Yes' },
    { stop_id: 'S2', stop_name: 'Market', lat: 11.01, lon: 78.01, radius_m: 100, kind: 'stop', active: 'Yes' },
    { stop_id: 'S3', stop_name: 'School', lat: 11.02, lon: 78.02, radius_m: 150, kind: 'school', active: 'Yes' }
  ]);
  fill(ss, 'Trip_Stops', [
    { trip_code: 'T1', sequence: 1, stop_id: 'S1' }, { trip_code: 'T1', sequence: 2, stop_id: 'S2' }, { trip_code: 'T1', sequence: 3, stop_id: 'S3' }]);
  fill(ss, 'Student_Trip_Stops', [{ admission_no: '99887', session: 'MORNING_PICKUP', trip_code: 'T1', stop_id: 'S1', notify: 'Yes', active: 'Yes' }]);
  fill(ss, 'Parent_Notify_Log', [
    { dedupe_key: 'k1', created_at: '2026-11-19 07:00:00', service_date: TODAY, event_type: 'bus_approaching', admission_no: '99887', stop_id: 'S1', status: 'Done' },
    { dedupe_key: 'k2', created_at: '2026-11-19 07:05:00', service_date: TODAY, event_type: 'bus_approaching', admission_no: '99888', stop_id: 'S2', status: 'Pending' }]);
  return g;
}

function as(g, email) { g.state.activeEmail = email; return g; }
function logRows(g) {
  const d = g.ss.sheets.GPS_Access_Log.data;
  return d.slice(1).filter((r) => r.some((v) => v !== ''));
}

// ---- R14 -------------------------------------------------------------------

const VIEW_FNS = [['getGpsLive', ''], ['getGpsTrack', "'V1', ''"], ['getGpsDaily', "''"]];
const MANAGE_FNS = [['getNotifyLog', "''"], ['gpsPushConfig', ''], ['gpsIssueToken', "'D1'"], ['gpsRevokeToken', "'D1'"]];

function assertRefused(g, fn, args, label) {
  const before = g.requests.n, logsBefore = logRows(g).length;
  const sheetsBefore = JSON.stringify(g.ss.sheets.GPS_Devices.data);
  const r = J(g.run(fn + '(' + args + ')'));
  assert.deepStrictEqual(Object.keys(r).sort(), ['error', 'ok'], label + ': only ok+error');
  assert.strictEqual(r.ok, false, label);
  assert.strictEqual(g.requests.n, before, label + ': no Worker request');
  assert.strictEqual(logRows(g).length, logsBefore, label + ': no log row');
  assert.strictEqual(JSON.stringify(g.ss.sheets.GPS_Devices.data), sheetsBefore, label + ': no sheet write');
  assert.ok(!/V1|V2|lat|99887/.test(JSON.stringify(r)), label + ': no data in refusal');
}

VIEW_FNS.concat(MANAGE_FNS).forEach(([fn, args]) => {
  test('R14 four refusal cases: ' + fn, () => {
    const g = world();
    // 1. anonymous
    as(g, ''); assertRefused(g, fn, args, fn + ' anonymous');
    // 2. valid admin PIN token in the cache, but nobody signed in
    g.sandbox.CacheService.getScriptCache().put('atk_abc123', 'admin', 300);
    as(g, ''); assertRefused(g, fn, args, fn + ' PIN token only');
    // 3. signed in, not on GPS_Access
    as(g, 'stranger@school.test'); assertRefused(g, fn, args, fn + ' not listed');
    // 4. listed but inactive
    as(g, 'gone@school.test'); assertRefused(g, fn, args, fn + ' inactive');
  });
});

MANAGE_FNS.forEach(([fn, args]) => {
  test('R14 view user is refused by manage function ' + fn, () => {
    const g = world();
    as(g, 'view@school.test');
    assertRefused(g, fn, args, fn + ' view role');
  });
});

test('view and manage users are admitted to the view functions; manage to manage functions', () => {
  const g = world();
  as(g, 'view@school.test');
  assert.strictEqual(J(g.run('getGpsLive()')).ok, true);
  as(g, 'boss@school.test');
  assert.strictEqual(J(g.run('getNotifyLog()')).ok, true);
});

test('gps_enabled = No closes every viewing function for everyone', () => {
  const g = world({ enabled: 'No' });
  as(g, 'boss@school.test');
  VIEW_FNS.concat([MANAGE_FNS[0]]).forEach(([fn, args]) => {
    const before = g.requests.n;
    const r = J(g.run(fn + '(' + args + ')'));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(g.requests.n, before);
  });
});

// ---- R17, R13 --------------------------------------------------------------

test('R17: 5 loads within 20 s make one Worker request; a 6th after 20 s makes another', () => {
  const g = as(world(), 'view@school.test');
  for (let i = 0; i < 5; i++) assert.strictEqual(J(g.run('getGpsLive()')).ok, true);
  assert.strictEqual(g.requests.n, 1);
  g.state.now += 21000;
  g.run('getGpsLive()');
  assert.strictEqual(g.requests.n, 2);
});

test('R15/R13: ordered Error, Stale, Pending, Live; Data as of from newest recv_ts; trip and next stop', () => {
  const g = as(world(), 'view@school.test');
  const r = J(g.run('getGpsLive()'));
  assert.deepStrictEqual(r.buses.map((b) => b.vehicle_id), ['V2', 'V3', 'V4', 'V1']);
  assert.deepStrictEqual(r.buses.map((b) => b.state), ['Error', 'Stale', 'Pending', 'Live']);
  assert.strictEqual(r.data_as_of, NOW - 60000);
  assert.strictEqual(r.data_as_of_text, J(g.run('gpsFormatHm_(' + (NOW - 60000) + ')')));
  assert.match(r.data_as_of_text, /^\d\d:\d\d$/);
  const v1 = r.buses.find((b) => b.vehicle_id === 'V1');
  assert.strictEqual(v1.trip_code, 'T1');
  assert.strictEqual(v1.next_stop.stop_id, 'S2', 'bus sits inside S1, so the next stop is S2');
  assert.ok(v1.next_stop.eta_min >= 1);
  assert.strictEqual(r.banner.level, 'amber');
  assert.ok(r.buses.every((b) => b.icon && b.state), 'icon and text on every bus');
});

test('R13: Worker down returns cached buses, the original time and a red banner', () => {
  const g = as(world(), 'view@school.test');
  const ok = J(g.run('getGpsLive()'));
  g.state.now += 25000; // fresh copy expired
  g.handler = () => ({ status: 503, body: 'down' });
  const r = J(g.run('getGpsLive()'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.down, true);
  assert.strictEqual(r.banner.level, 'red');
  assert.ok(r.banner.text.includes(ok.data_as_of_text), 'banner carries the original time');
  assert.deepStrictEqual(r.buses.map((b) => b.vehicle_id), ok.buses.map((b) => b.vehicle_id));
  assert.strictEqual(r.data_as_of_text, ok.data_as_of_text);
  assert.strictEqual(g.state.fetchCalls.length, 1 + 3, 'three tries then give up');
  g.run('getGpsLive()');
  assert.strictEqual(g.state.fetchCalls.length, 1 + 3, 'short back-off: a failed Worker is not hammered');
});

test('R13: Worker down with nothing cached is never blank: ok, empty list, red banner', () => {
  const g = as(world(), 'view@school.test');
  g.handler = () => { throw new Error('network'); };
  const r = J(g.run('getGpsLive()'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.down, true);
  assert.deepStrictEqual(r.buses, []);
  assert.strictEqual(r.banner.level, 'red');
});

test('missing Script Properties: clean down state, no fetch, no throw', () => {
  const g = as(world(), 'view@school.test');
  Object.keys(g.state.propStore).forEach((k) => delete g.state.propStore[k]);
  const r = J(g.run('getGpsLive()'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.down, true);
  assert.strictEqual(g.requests.n, 0);
});

test('read calls send only the read secret header, config calls only the config secret', () => {
  const g = as(world(), 'boss@school.test');
  g.run('getGpsLive()');
  g.run('gpsPushConfig()');
  const [read, cfg] = g.state.fetchCalls;
  assert.deepStrictEqual(Object.keys(read.headers), ['X-Transport-Read-Secret']);
  assert.strictEqual(read.headers['X-Transport-Read-Secret'], PROPS.GPS_READ_SECRET);
  assert.deepStrictEqual(Object.keys(cfg.headers), ['X-Transport-Config-Secret']);
  assert.strictEqual(cfg.headers['X-Transport-Config-Secret'], PROPS.GPS_CONFIG_SECRET);
  assert.ok(!/\?/.test(read.url.replace('/v1/latest', '')), 'no secret or id in the query');
});

test('secrets never reach logs, cache, sheets or responses', () => {
  const g = as(world(), 'boss@school.test');
  g.handler = () => ({ status: 500, body: 'x' });
  const outs = [g.run('getGpsLive()'), g.run('gpsPushConfig()'), g.run("gpsIssueToken('D1')")].map(J);
  const dump = JSON.stringify([g.state.logs, g.state.cacheStore, outs, Object.keys(g.ss.sheets).map((n) => g.ss.sheets[n].data)]);
  assert.ok(!dump.includes('READ-SECRET-VALUE') && !dump.includes('CONFIG-SECRET-VALUE'));
  assert.ok(!dump.includes('worker.example.test'), 'no URL either');
});

// ---- retry -----------------------------------------------------------------

test('retry: 500 then 200 succeeds on try 2 after one 500 ms pause', () => {
  const g = as(world(), 'view@school.test');
  let n = 0;
  g.handler = () => (++n === 1 ? { status: 500, body: 'x' } : { status: 200, body: latestBody() });
  const r = J(g.run('getGpsLive()'));
  assert.strictEqual(r.down, false);
  assert.strictEqual(g.state.fetchCalls.length, 2);
  assert.deepStrictEqual(g.state.sleeps, [500]);
});

test('retry: 4xx is not retried; 503 x3 backs off 500 then 1500', () => {
  const g = loadGas(['GpsSetup.js', 'GpsWorker.js'], { props: PROPS, fetch: () => ({ status: 401, body: 'no' }) });
  const r = J(g.run("gpsWorkerCall_('read','GET','/v1/latest',null)"));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(g.state.fetchCalls.length, 1);
  const h = loadGas(['GpsSetup.js', 'GpsWorker.js'], { props: PROPS, fetch: () => ({ status: 503, body: 'no' }) });
  h.run("gpsWorkerCall_('read','GET','/v1/latest',null)");
  assert.strictEqual(h.state.fetchCalls.length, 3);
  assert.deepStrictEqual(h.state.sleeps, [500, 1500]);
});

// ---- R16 -------------------------------------------------------------------

test('R16: a 6-minute gap is exactly one dashed segment; stop geofences are returned', () => {
  const g = as(world(), 'view@school.test');
  const r = J(g.run("getGpsTrack('V1', '')"));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.segments.filter((s) => s.dashed).length, 1);
  assert.strictEqual(r.segments.filter((s) => !s.dashed).length, 2);
  assert.strictEqual(r.stops.length, 3);
  assert.ok(r.stops.every((s) => s.radius_m > 0));
});

test('track input is validated after the role check', () => {
  const g = as(world(), 'view@school.test');
  assert.strictEqual(J(g.run("getGpsTrack('../x', '')")).ok, false);
  assert.strictEqual(J(g.run("getGpsTrack('V1', '19-11-2026')")).ok, false);
  assert.strictEqual(g.requests.n, 0);
});

test('gpsBuildSegments_: gaps at exactly 2 minutes stay solid, over 2 minutes dash', () => {
  const g = loadGas(['GpsSetup.js', 'GpsEndpoints.js']);
  const mk = (ts) => ts.map((t, i) => ({ t, la: 11 + i / 1000, lo: 78 }));
  assert.strictEqual(J(g.sandbox.gpsBuildSegments_(mk([0, 120000, 240000]), 120000)).filter((s) => s.dashed).length, 0);
  assert.strictEqual(J(g.sandbox.gpsBuildSegments_(mk([0, 60000, 180001, 200000]), 120000)).filter((s) => s.dashed).length, 1);
  assert.deepStrictEqual(J(g.sandbox.gpsBuildSegments_([], 120000)), []);
});

// ---- R18 -------------------------------------------------------------------

test('R18: opening the map then a track adds 2 rows with the viewer address; refresh does not add rows', () => {
  const g = as(world(), 'view@school.test');
  g.run('getGpsLive()');
  g.run("getGpsTrack('V1', '')");
  g.run('getGpsLive()'); // 30 s auto refresh
  const rows = logRows(g);
  assert.strictEqual(rows.length, 2);
  const hdr = g.ss.sheets.GPS_Access_Log.data[0];
  const col = (h) => hdr.indexOf(h);
  assert.ok(rows.every((r) => r[col('viewer_email')] === 'view@school.test'));
  assert.deepStrictEqual(rows.map((r) => r[col('view')].split(':')[0]), ['live', 'track']);
});

test('R18: notify log views are logged too', () => {
  const g = as(world(), 'boss@school.test');
  g.run('getNotifyLog()');
  const rows = logRows(g);
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0][g.ss.sheets.GPS_Access_Log.data[0].indexOf('view')], /^notify_log:/);
});

test('R18: if the view cannot be recorded it is refused (no unlogged view)', () => {
  const g = as(world(), 'view@school.test');
  delete g.ss.sheets.GPS_Access_Log;
  const r = J(g.run('getGpsLive()'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(g.requests.n, 0);
});

test('getNotifyLog never returns admission numbers', () => {
  const g = as(world(), 'boss@school.test');
  const r = J(g.run('getNotifyLog()'));
  assert.strictEqual(r.total, 2);
  assert.ok(!JSON.stringify(r).includes('99887') && !JSON.stringify(r).includes('admission'));
  assert.deepStrictEqual(r.rows.map((x) => x.created_at), ['2026-11-19 07:05:00', '2026-11-19 07:00:00']);
});

// ---- R20 -------------------------------------------------------------------

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function keysDeep(v, out) {
  out = out || [];
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { out.push(k); keysDeep(v[k], out); });
  return out;
}

test('R20: config payload shape, hash matches the Worker algorithm, no admission data', () => {
  const g = as(world(), 'boss@school.test');
  const r = J(g.run('gpsPushConfig()'));
  assert.strictEqual(r.ok, true);
  const call = g.state.fetchCalls[0];
  assert.strictEqual(call.method, 'POST');
  assert.strictEqual(call.url, URL_BASE + '/v1/admin/config');
  const body = JSON.parse(call.payload);
  assert.deepStrictEqual(Object.keys(body).sort(), ['content_hash', 'devices', 'settings', 'stops', 'trip_stops', 'trips']);
  assert.ok(!keysDeep(body).some((k) => /admission/i.test(k)), 'no admission key at any depth');
  assert.ok(!call.payload.includes('99887'), 'no student value either');
  const { content_hash, ...data } = body;
  assert.strictEqual(content_hash, crypto.createHash('sha256').update(canon(data), 'utf8').digest('hex'));
  // sections
  assert.deepStrictEqual(body.devices.map((d) => [d.device_id, d.active]), [['D1', 1], ['D2', 0]], 'D2 is past active_to');
  assert.strictEqual(body.devices[1].store_outside_window, 1);
  assert.strictEqual(body.trips[0].window_start, '00:00');
  assert.strictEqual(body.stops.length, 3);
  assert.deepStrictEqual(body.trip_stops.map((x) => x.sequence), [1, 2, 3]);
  assert.strictEqual(body.settings.gps_stale_minutes, '5');
  assert.ok(!('gps_enabled' in body.settings) && !('parent_notify_mode' in body.settings));
  // Student_Trip_Stops is never even read
  assert.ok(!g.state.logs.some((l) => /Student/.test(l)));
});

test('R20: a changed stop radius changes the hash; an unchanged push repeats it', () => {
  const g = as(world(), 'boss@school.test');
  g.run('gpsPushConfig()'); g.run('gpsPushConfig()');
  const h = g.state.fetchCalls.map((c) => JSON.parse(c.payload).content_hash);
  assert.strictEqual(h[0], h[1]);
  const stops = g.ss.sheets.Transport_Stops;
  stops.data[1][stops.data[0].indexOf('radius_m')] = 250;
  g.state.now += 400000; // fleet-config cache irrelevant to push, which reads fresh
  g.run('gpsPushConfig()');
  assert.notStrictEqual(JSON.parse(g.state.fetchCalls[2].payload).content_hash, h[0]);
});

test('R20: a payload with an admission key is refused before sending', () => {
  const g = loadGas(['GpsSetup.js', 'GpsWorker.js']);
  g.sandbox.gpsBuildConfigData_ = () => ({ devices: [], trips: [], stops: [{ stop_id: 'S', Admission_No: '1' }], trip_stops: [], settings: {} });
  assert.throws(() => g.sandbox.gpsBuildConfigBody_({}, '2026-01-01', () => 'x'), /admission/i);
  assert.strictEqual(g.sandbox.gpsHasAdmissionKey_({ a: [{ b: { Admission_No: 1 } }] }), true);
  assert.strictEqual(g.sandbox.gpsHasAdmissionKey_({ stop_name: 'Admission Office' }), false, 'values are not inspected');
});

test('R20: rows without ids are dropped so the Worker does not reject the whole push', () => {
  const g = loadGas(['GpsSetup.js', 'GpsWorker.js']);
  const d = J(g.sandbox.gpsBuildConfigData_({ devices: [{ device_id: '' }], trips: [{ trip_code: ' ' }], stops: [{ stop_id: '' }], tripStops: [{ trip_code: 'T', stop_id: '' }], settings: [] }, '2026-01-01'));
  assert.deepStrictEqual(d, { devices: [], trips: [], stops: [], trip_stops: [], settings: {} });
});

// ---- R21 -------------------------------------------------------------------

function fakeUi(g, id) {
  const shown = { alerts: [], dialogs: [] };
  g.sandbox.SpreadsheetApp.getUi = () => ({
    Button: { OK: 'OK' }, ButtonSet: { OK: 'OKS', OK_CANCEL: 'OKC' },
    prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => id }),
    alert: (...a) => { shown.alerts.push(a.join(' | ')); },
    showModalDialog: (o, title) => { shown.dialogs.push(title); }
  });
  return shown;
}

test('R21: token is shown once in the dialog, only last4 and issue time reach the Sheet', () => {
  const g = as(world(), 'boss@school.test');
  const ui = fakeUi(g, 'D1');
  g.run('menuIssueGpsToken()');
  assert.strictEqual(ui.dialogs.length, 1);
  const tpl = g.state.templates[0];
  assert.strictEqual(tpl.name, 'GpsTokenDialog');
  assert.strictEqual(tpl.url, URL_BASE + '/v1/osmand/' + TOKEN);
  const hdr = g.ss.sheets.GPS_Devices.data[0];
  const row = g.ss.sheets.GPS_Devices.data[1];
  assert.strictEqual(row[hdr.indexOf('device_id')], 'D1');
  assert.strictEqual(row[hdr.indexOf('token_last4')], TOKEN.slice(-4));
  assert.match(String(row[hdr.indexOf('token_issued_at')]), /^2026-11-19/);
  assert.strictEqual(row[hdr.indexOf('edited_by')], 'boss@school.test');
  const dump = JSON.stringify([
    Object.keys(g.ss.sheets).map((n) => g.ss.sheets[n].data), g.state.cacheStore, g.state.propStore, g.state.logs, ui.alerts]);
  assert.ok(!dump.includes(TOKEN) && !dump.includes('TOKENabcdef'), 'token appears nowhere persisted or logged');
  assert.deepStrictEqual(Object.keys(g.state.fetchCalls[0].headers), ['X-Transport-Config-Secret']);
  assert.deepStrictEqual(JSON.parse(g.state.fetchCalls[0].payload), { device_id: 'D1', vehicle_id: 'V1', kind: 'phone', store_outside_window: false });
});

test('R21: web function returns the link once and persists nothing but last4', () => {
  const g = as(world(), 'boss@school.test');
  const r = J(g.run("gpsIssueToken('D1')"));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.token_last4, TOKEN.slice(-4));
  assert.ok(!('token' in r));
  const dump = JSON.stringify([Object.keys(g.ss.sheets).map((n) => g.ss.sheets[n].data), g.state.cacheStore, g.state.propStore, g.state.logs]);
  assert.ok(!dump.includes(TOKEN));
});

test('R21: unknown device or bad id is refused without calling the Worker; revoke marks the row', () => {
  const g = as(world(), 'boss@school.test');
  assert.strictEqual(J(g.run("gpsIssueToken('NOPE')")).ok, false);
  assert.strictEqual(J(g.run("gpsIssueToken('bad id!')")).ok, false);
  assert.strictEqual(J(g.run("gpsRevokeToken('bad id!')")).ok, false);
  assert.strictEqual(g.requests.n, 0);
  assert.strictEqual(J(g.run("gpsRevokeToken('D1')")).ok, true);
  const hdr = g.ss.sheets.GPS_Devices.data[0];
  assert.strictEqual(g.ss.sheets.GPS_Devices.data[1][hdr.indexOf('status')], 'Revoked');
  assert.strictEqual(g.state.fetchCalls[0].url, URL_BASE + '/v1/admin/tokens/revoke');
});

test('menu twins refuse a non-manager before prompting or calling the Worker', () => {
  ['menuPushGpsConfig', 'menuIssueGpsToken', 'menuRevokeGpsToken'].forEach((fn) => {
    ['', 'stranger@school.test', 'view@school.test', 'gone@school.test'].forEach((email) => {
      const g = as(world(), email);
      const ui = fakeUi(g, 'D1');
      g.run(fn + '()');
      assert.strictEqual(g.requests.n, 0, fn + ' ' + email);
      assert.strictEqual(ui.alerts.length, 1);
      assert.strictEqual(ui.dialogs.length, 0);
    });
  });
});
