'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { loadGas, makeSpreadsheet } = require('./gas-stubs');

const J = (x) => JSON.parse(JSON.stringify(x));
const KEY = 'test-key-not-a-secret';
// 2026-11-19 10:00 IST = 04:30 UTC
const NOW = Date.UTC(2026, 10, 19, 4, 30, 0);
const hmac = (ts, body, key) => crypto.createHmac('sha256', key || KEY).update(`${ts}.${body}`).digest('hex');

function ev(o) {
  const e = Object.assign({
    trip_run_id: '2026-11-19|T1', service_date: '2026-11-19', trip_code: 'T1', session: 'MORNING_PICKUP',
    route_no: '5', vehicle_id: 'V1', stop_id: 'S2', stop_name: 'Main Rd', sequence: 2,
    event_type: 'bus_approaching', event_ts: NOW - 1000, eta_minutes: 5, expires_at: NOW + 7 * 60000
  }, o || {});
  e.event_key = `${e.trip_run_id}|${e.stop_id}|${e.event_type}`;
  return e;
}
const batch = (events) => JSON.stringify({ v: 1, sent_at: NOW, events });
const req = (body, o) => {
  o = o || {};
  const ts = String(o.ts == null ? NOW : o.ts);
  return { parameter: { ts, sig: o.sig == null ? hmac(ts, body, o.key) : o.sig }, postData: { contents: body } };
};

const STUDENTS = [
  ['admission_no', 'session', 'trip_code', 'stop_id', 'notify', 'active', 'gcm_reachable', 'edited_by', 'edited_at'],
  ['C000001', 'MORNING_PICKUP', 'T1', 'S2', 'Yes', 'Yes', 'Yes', '', ''],
  ['C000002', 'MORNING_PICKUP', 'T1', 'S2', 'No', 'Yes', 'Yes', '', ''],
  ['C000003', 'MORNING_PICKUP', 'T1', 'S3', 'Yes', 'Yes', 'Yes', '', ''],
  ['C000004', 'MORNING_PICKUP', 'T1', 'S2', 'Yes', 'No', 'Yes', '', ''],
  ['C000005', 'AFTERNOON_DROP', 'T1', 'S2', 'Yes', 'Yes', 'Yes', '', ''],
  ['C000006', 'MORNING_PICKUP', 'T9', 'S2', 'Yes', 'Yes', 'Yes', '', '']
];

const FILES = ['GpsSetup.js', 'GpsWorker.js', 'GpsEndpoints.js', 'GpsWatchdog.js', 'GpsEvents.js'];
const LOG_SETUP = 'gpsEnsureHeader_(SpreadsheetApp.getActiveSpreadsheet().insertSheet("Parent_Notify_Log"), GPS_HEADERS.Parent_Notify_Log)';

function world(settings, o) {
  o = o || {};
  const ss = makeSpreadsheet();
  const set = ss.insertSheet('Settings');
  set.data = [['setting', 'value', 'notes']].concat(Object.keys(settings || {}).map((k) => [k, settings[k], '']));
  const st = ss.insertSheet('Student_Trip_Stops'); st.data = STUDENTS.map((r) => r.slice());
  const g = loadGas(FILES, { ss, props: { GPS_EVENT_HMAC_KEY: KEY } });
  if (!o.noLog) g.run(LOG_SETUP);
  const post = (r, now) => {
    g.sandbox.__r = r; g.sandbox.__n = now == null ? NOW : now;
    return J(g.run('gpsEvHandle_(__r, __n)'));
  };
  const rowsOf = () => {
    const log = ss.sheets.Parent_Notify_Log;
    if (!log) return [];
    const h = log.data[0];
    return log.data.slice(1).map((r) => { const x = {}; h.forEach((k, i) => { x[k] = r[i]; }); return x; });
  };
  return { g, ss, get log() { return ss.sheets.Parent_Notify_Log; }, post, rowsOf };
}
const ALL_TYPES = 'bus_reached_school,bus_left_school,bus_approaching,bus_at_previous_stop';
const SHADOW_GCM = { parent_notify_mode: 'shadow_gcm', parent_notify_types: ALL_TYPES };

// ---- signature ----
test('verify: good signature passes; bad, tampered, stale, future, malformed, oversize all fail', () => {
  const g = loadGas(['GpsSetup.js', 'GpsWorker.js', 'GpsEvents.js']);
  const hx = (m, k) => crypto.createHmac('sha256', k).update(m).digest('hex');
  const V = (key, ts, sig, body, now) => J(g.sandbox.gpsEvVerify_(key, ts, sig, body, now, hx));
  const body = '{"a":1}', ts = String(NOW), good = hmac(ts, body);
  assert.deepStrictEqual(V(KEY, ts, good, body, NOW), { ok: true });
  assert.deepStrictEqual(V(KEY, ts, good.toUpperCase(), body, NOW), { ok: true }, 'hex case is not significant');
  assert.strictEqual(V(KEY, ts, hmac(ts, body, 'other'), body, NOW).ok, false);
  assert.strictEqual(V(KEY, ts, good, body + ' ', NOW).ok, false, 'tampered body');
  assert.strictEqual(V(KEY, String(NOW + 1), good, body, NOW).ok, false, 'ts is part of the signed string');
  const old = String(NOW - 5 * 60000 - 1), fut = String(NOW + 5 * 60000 + 1);
  assert.strictEqual(V(KEY, old, hmac(old, body), body, NOW).reason, 'stale_ts');
  assert.strictEqual(V(KEY, fut, hmac(fut, body), body, NOW).reason, 'stale_ts');
  const edge = String(NOW - 5 * 60000);
  assert.strictEqual(V(KEY, edge, hmac(edge, body), body, NOW).ok, true, 'exactly 5 min is inside');
  assert.strictEqual(V('', ts, good, body, NOW).reason, 'no_key');
  assert.strictEqual(V(KEY, 'abc', good, body, NOW).reason, 'bad_ts');
  assert.strictEqual(V(KEY, ts, 'zz', body, NOW).reason, 'bad_sig');
  assert.strictEqual(V(KEY, ts, '', body, NOW).ok, false);
  assert.strictEqual(V(KEY, ts, good, '', NOW).ok, false);
  const big = 'x'.repeat(100001);
  assert.strictEqual(V(KEY, ts, hmac(ts, big), big, NOW).reason, 'too_big');
  assert.strictEqual(g.sandbox.gpsEvSafeEqual_('abc', 'abc'), true);
  assert.strictEqual(g.sandbox.gpsEvSafeEqual_('abc', 'abd'), false);
  assert.strictEqual(g.sandbox.gpsEvSafeEqual_('abc', 'abcd'), false);
});

// ---- schema ----
test('schema: valid batch accepted; each reject case refused', () => {
  const g = loadGas(['GpsSetup.js', 'GpsWorker.js', 'GpsEvents.js']);
  const P = (b) => J(g.sandbox.gpsEvParseBatch_(typeof b === 'string' ? b : JSON.stringify(b)));
  assert.strictEqual(P(batch([ev()])).ok, true);
  assert.strictEqual(P(batch([ev({ eta_minutes: null, route_no: null, stop_name: null })])).ok, true);
  const bad = (events, why) => assert.strictEqual(P(batch(events)).reason, why);
  assert.strictEqual(P('not json').reason, 'bad_json');
  assert.strictEqual(P('[]').reason, 'not_object');
  assert.strictEqual(P({ v: 2, sent_at: NOW, events: [ev()] }).reason, 'bad_version');
  assert.strictEqual(P({ v: 1, sent_at: NOW, events: [ev()], extra: 1 }).reason, 'unknown_field');
  assert.strictEqual(P({ v: 1, sent_at: NOW, admission_no: 'C1', events: [ev()] }).reason, 'admission_key');
  assert.strictEqual(P({ v: 1, sent_at: NOW, events: [] }).reason, 'bad_events');
  assert.strictEqual(P({ v: 1, sent_at: NOW, events: 'x' }).reason, 'bad_events');
  assert.strictEqual(P({ v: 1, sent_at: 'x', events: [ev()] }).reason, 'bad_sent_at');
  assert.strictEqual(P({ v: 1, sent_at: NOW, events: Array.from({ length: 51 }, () => ev()) }).reason, 'bad_events');
  assert.strictEqual(P({ v: 1, sent_at: NOW, events: Array.from({ length: 50 }, () => ev()) }).ok, true);
  bad([Object.assign(ev(), { admission_no: 'C1' })], 'admission_key');
  bad([Object.assign(ev(), { phone: '1' })], 'unknown_field');
  bad([Object.assign(ev(), { event_key: 'x|y|z' })], 'bad_event_key');
  bad([ev({ session: 'NIGHT' })], 'bad_session');
  bad([ev({ stop_id: '=cmd()' })], 'bad_stop_id');
  bad([ev({ trip_code: 'T 1' })], 'bad_trip_code');
  bad([ev({ vehicle_id: '' })], 'bad_vehicle_id');
  bad([ev({ service_date: '19-11-2026' })], 'bad_service_date');
  bad([ev({ service_date: '2026-11-18' })], 'date_mismatch');
  bad([ev({ trip_run_id: '=1|T1' })], 'bad_trip_run_id');
  bad([ev({ sequence: -1 })], 'bad_sequence');
  bad([ev({ event_ts: 'now' })], 'bad_event_ts');
  bad([ev({ eta_minutes: 'soon' })], 'bad_eta');
  bad([ev({ expires_at: NOW - 1e6 })], 'bad_expires_at');
  bad([ev({ expires_at: NOW + 24 * 3600000 })], 'bad_expires_at');
  bad([ev(), null], 'event_not_object');
  const e = ev(); e.event_type = 'bus_exploded'; e.event_key = `${e.trip_run_id}|${e.stop_id}|bus_exploded`;
  bad([e], 'bad_event_type');
});

// ---- fan-out ----
test('fan-out: stop event reaches only notify=Yes, active=Yes students at that stop, trip and session', () => {
  const w = world({ parent_notify_mode: 'shadow_local' });
  const r = w.post(req(batch([ev()])));
  assert.deepStrictEqual([r.ok, r.written], [true, 1]);
  const rows = w.rowsOf();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].admission_no, 'C000001');
  assert.strictEqual(rows[0].dedupe_key, '2026-11-19|T1|C000001|bus_approaching');
  assert.strictEqual(rows[0].event_id, '2026-11-19|T1|S2|bus_approaching');
  assert.strictEqual(rows[0].created_at, '2026-11-19 10:00:00');
  assert.strictEqual(rows[0].expires_at, NOW + 7 * 60000);
  assert.strictEqual(rows[0].eta_minutes, 5);
  assert.strictEqual(rows[0].status, 'local_only');
  assert.strictEqual(rows[0].mode, 'shadow_local');
  assert.ok(w.g.state.flushes >= 1, 'flushed before ok');
  assert.strictEqual(w.g.state.lockHeld, false, 'lock released');
});

test('fan-out: notify=No student gets no row; stop with no students writes nothing', () => {
  const w = world({ parent_notify_mode: 'shadow_local' });
  w.post(req(batch([ev({ stop_id: 'S9' })])));
  assert.strictEqual(w.rowsOf().length, 0);
  w.post(req(batch([ev()])));
  assert.ok(!w.rowsOf().some((x) => x.admission_no === 'C000002'));
});

test('fan-out: school events go to every notify=Yes student on the trip and session', () => {
  const w = world({ parent_notify_mode: 'shadow_local' });
  w.post(req(batch([ev({ event_type: 'bus_reached_school', stop_id: 'SCH', sequence: 9 })])));
  assert.deepStrictEqual(w.rowsOf().map((x) => x.admission_no).sort(), ['C000001', 'C000003']);
  const w2 = world({ parent_notify_mode: 'shadow_local' });
  w2.post(req(batch([ev({ event_type: 'bus_left_school', stop_id: 'SCH', session: 'AFTERNOON_DROP' })])));
  assert.deepStrictEqual(w2.rowsOf().map((x) => x.admission_no), ['C000005']);
});

test('fan-out: school event in the wrong session writes nothing', () => {
  const w = world({ parent_notify_mode: 'shadow_local' });
  w.post(req(batch([ev({ event_type: 'bus_left_school', stop_id: 'SCH' })])));
  w.post(req(batch([ev({ event_type: 'bus_reached_school', stop_id: 'SCH', session: 'AFTERNOON_DROP' })])));
  assert.strictEqual(w.rowsOf().length, 0);
});

test('replay: same batch three times (same and fresh signatures) changes nothing', () => {
  const w = world(SHADOW_GCM);
  const body = batch([ev({ event_type: 'bus_reached_school', stop_id: 'SCH' }), ev()]);
  const first = w.post(req(body));
  assert.strictEqual(first.ok, true);
  const snap = JSON.stringify(w.log.data);
  const r2 = w.post(req(body));                       // same signature: cache no-op
  assert.deepStrictEqual([r2.ok, r2.replay], [true, true]);
  const r3 = w.post(req(body, { ts: NOW + 1000 }), NOW + 1000);   // fresh signature: dedupe_key no-op
  assert.deepStrictEqual([r3.ok, r3.written], [true, 0]);
  const r4 = w.post(req(body, { ts: NOW + 2000 }), NOW + 2000);
  assert.deepStrictEqual([r4.ok, r4.written], [true, 0]);
  assert.strictEqual(JSON.stringify(w.log.data), snap);
});

test('replay: a failed first delivery is not cached as seen', () => {
  const w = world({ parent_notify_mode: 'shadow_local' }, { noLog: true });
  const body = batch([ev()]);
  assert.throws(() => w.post(req(body)), /Parent_Notify_Log tab missing/);
  w.g.run(LOG_SETUP);
  const r = w.post(req(body));
  assert.deepStrictEqual([r.ok, r.written], [true, 1]);
});

// ---- modes ----
test('mode matrix: each mode x type x gate_l_passed x enabled', () => {
  let n = 0;
  ['shadow_local', 'shadow_gcm', 'live'].forEach((mode) => {
    ['Yes', 'No'].forEach((gate) => {
      ['bus_approaching', 'bus_at_previous_stop', 'bus_reached_school', 'bus_left_school'].forEach((type) => {
        [true, false].forEach((enabled) => {
          const c = { mode, gate, type, enabled };
          const session = type === 'bus_left_school' ? 'AFTERNOON_DROP' : 'MORNING_PICKUP';
          const others = ALL_TYPES.split(',').filter((t) => t !== type).join(',');
          const w = world({ parent_notify_mode: mode, gate_l_passed: gate, parent_notify_trips: 'T1',
            parent_notify_types: enabled ? ALL_TYPES : others });
          w.post(req(batch([ev({ event_type: type, session, stop_id: type.includes('school') ? 'SCH' : 'S2' })])));
          const rows = w.rowsOf();
          assert.ok(rows.length >= 1, JSON.stringify(c));
          const stopLevel = type === 'bus_approaching' || type === 'bus_at_previous_stop';
          let want, why = '';
          if (mode === 'shadow_local') want = 'local_only';
          else if (!enabled) { want = 'local_only'; why = 'type_not_enabled'; }
          else if (stopLevel && gate === 'No') { want = 'local_only'; why = 'gate_l_not_passed'; }
          else want = 'pending_feed';
          rows.forEach((r) => {
            assert.strictEqual(r.status, want, JSON.stringify(c));
            assert.strictEqual(r.suppressed_reason, why, JSON.stringify(c));
            assert.strictEqual(r.mode, mode);
          });
          n++;
        });
      });
    });
  });
  assert.strictEqual(n, 48);
});

test('mode live: trip must be listed in parent_notify_trips (blank = none)', () => {
  const s = Object.assign({}, SHADOW_GCM, { parent_notify_mode: 'live', gate_l_passed: 'Yes' });
  const a = world(Object.assign({}, s, { parent_notify_trips: '' }));
  a.post(req(batch([ev()])));
  assert.deepStrictEqual([a.rowsOf()[0].status, a.rowsOf()[0].suppressed_reason], ['local_only', 'trip_not_enabled']);
  const b = world(Object.assign({}, s, { parent_notify_trips: 'T1' }));
  b.post(req(batch([ev()])));
  assert.strictEqual(b.rowsOf()[0].status, 'pending_feed');
});

test('mode off: events dropped with a counter, nothing written; unknown mode behaves as shadow_local', () => {
  const w = world({ parent_notify_mode: 'off' });
  const r = w.post(req(batch([ev(), ev({ stop_id: 'S3' })])));
  assert.deepStrictEqual([r.ok, r.dropped], [true, 2]);
  assert.strictEqual(w.rowsOf().length, 0);
  const w2 = world({ parent_notify_mode: 'LIVE!!' });
  w2.post(req(batch([ev()])));
  assert.deepStrictEqual([w2.rowsOf()[0].status, w2.rowsOf()[0].mode], ['local_only', 'shadow_local']);
  const w3 = world({});
  w3.post(req(batch([ev()])));
  assert.strictEqual(w3.rowsOf()[0].status, 'local_only', 'missing setting is shadow_local');
});

// ---- window and expiry ----
test('outside gcm_send_window: would-be pending_feed becomes suppressed: outside_gcm_window', () => {
  const night = Date.UTC(2026, 10, 19, 14, 0, 0); // 19:30 IST
  const e = ev({ event_type: 'bus_left_school', stop_id: 'SCH', session: 'AFTERNOON_DROP', event_ts: night - 1000, expires_at: night + 600000 });
  const w = world(SHADOW_GCM);
  const body = batch([e]);
  w.post(req(body, { ts: night }), night);
  const r = w.rowsOf();
  assert.deepStrictEqual([r[0].status, r[0].suppressed_reason], ['suppressed', 'outside_gcm_window']);
  // same instant in shadow_local is only measured
  const l = world({ parent_notify_mode: 'shadow_local' });
  l.post(req(body, { ts: night }), night);
  assert.strictEqual(l.rowsOf()[0].status, 'local_only');
  // configurable window, and bad values fall back to the default
  const c = world(Object.assign({ gcm_send_window: '07:00-20:00' }, SHADOW_GCM));
  c.post(req(body, { ts: night }), night);
  assert.strictEqual(c.rowsOf()[0].status, 'pending_feed');
  const g = loadGas(['GpsSetup.js', 'GpsWorker.js', 'GpsEvents.js']);
  assert.deepStrictEqual(J(g.sandbox.gpsEvParseWindow_('garbage')), { start: 420, end: 1140 });
  assert.deepStrictEqual(J(g.sandbox.gpsEvParseWindow_('19:00-07:00')), { start: 420, end: 1140 });
  assert.strictEqual(g.sandbox.gpsEvInWindow_(Date.UTC(2026, 10, 19, 1, 30), { start: 420, end: 1140 }), true);  // 07:00
  assert.strictEqual(g.sandbox.gpsEvInWindow_(Date.UTC(2026, 10, 19, 13, 30), { start: 420, end: 1140 }), false); // 19:00
});

test('event past expires_at on arrival is suppressed: after_expires_at', () => {
  const w = world(SHADOW_GCM);
  w.post(req(batch([ev({ event_type: 'bus_reached_school', stop_id: 'SCH', event_ts: NOW - 30 * 60000, expires_at: NOW - 10 * 60000 })])));
  const r = w.rowsOf();
  assert.ok(r.length === 2 && r.every((x) => x.status === 'suppressed' && x.suppressed_reason === 'after_expires_at'));
});

// ---- doPost never throws or leaks ----
test('doPost: every failure answers {"ok":false} with no detail, and nothing is logged from the request', () => {
  const w = world(SHADOW_GCM);
  const good = batch([ev()]);
  const secretBody = batch([ev({ stop_name: 'SECRET-STOP-NAME' })]);
  const cases = [
    undefined, null, {}, { parameter: {} }, { parameter: { ts: 'x', sig: 'y' }, postData: {} },
    { parameter: { ts: String(NOW), sig: 'f'.repeat(64) }, postData: { contents: secretBody } },
    req(secretBody, { sig: '0'.repeat(64) }),
    req(secretBody, { ts: NOW - 6 * 60000 }),
    req('{"v":1,"sent_at":1,"events":"x"}')
  ];
  cases.forEach((c) => {
    w.g.sandbox.__e = c;
    const out = w.g.run('doPost(__e)');
    assert.strictEqual(out.getContent(), '{"ok":false}');
  });
  assert.strictEqual(w.rowsOf().length, 0);
  // a valid one through the real doPost entry point (uses the real clock, so sign for now)
  const ts = String(Date.now());
  w.g.sandbox.__e = { parameter: { ts, sig: hmac(ts, good) }, postData: { contents: good } };
  const real = JSON.parse(w.g.run('doPost(__e)').getContent());
  assert.strictEqual(real.ok, true);
  const logs = w.g.state.logs.join('\n');
  assert.ok(!logs.includes('SECRET-STOP-NAME'));
  assert.ok(!logs.includes('f'.repeat(64)) && !logs.includes(KEY) && !logs.includes(hmac(ts, good)));
});

test('doPost: internal errors (missing tab, busy lock, missing key) answer {"ok":false}, never throw', () => {
  const body = batch([ev()]);
  const a = world({ parent_notify_mode: 'shadow_local' }, { noLog: true });
  a.g.sandbox.__e = req(body, { ts: Date.now() });
  assert.strictEqual(a.g.run('doPost(__e)').getContent(), '{"ok":false}');
  const b = world({ parent_notify_mode: 'shadow_local' });
  b.g.state.lockBusy = true;
  b.g.sandbox.__e = req(body, { ts: Date.now() });
  assert.strictEqual(b.g.run('doPost(__e)').getContent(), '{"ok":false}');
  assert.strictEqual(b.rowsOf().length, 0);
  const c = world({ parent_notify_mode: 'shadow_local' });
  delete c.g.state.propStore.GPS_EVENT_HMAC_KEY;
  c.g.sandbox.__e = req(body, { ts: Date.now() });
  assert.strictEqual(c.g.run('doPost(__e)').getContent(), '{"ok":false}');
});

test('writes follow live header order (extra and reordered columns), one setValues', () => {
  const w = world({ parent_notify_mode: 'shadow_local' });
  const h = w.log.data[0];
  w.log.data[0] = ['note_col'].concat(h.slice().reverse());
  let calls = 0;
  const orig = w.log.getRange;
  w.log.getRange = (...a) => { const r = orig(...a); const sv = r.setValues; r.setValues = (v) => { calls++; return sv(v); }; return r; };
  w.post(req(batch([ev({ event_type: 'bus_reached_school', stop_id: 'SCH' })])));
  assert.strictEqual(calls, 1);
  const rows = w.rowsOf();
  assert.deepStrictEqual(rows.map((r) => r.admission_no).sort(), ['C000001', 'C000003']);
  assert.ok(rows.every((r) => r.note_col === '' && r.status === 'local_only'));
});

test('no admission number appears in anything doPost returns', () => {
  const w = world(SHADOW_GCM);
  const r = w.post(req(batch([ev()])));
  assert.ok(!/C0000/.test(JSON.stringify(r)));
});
