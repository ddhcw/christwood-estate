'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildWorld, NOW, OUTBOX_HEADERS, GPS_HEADERS, GPS_SHEETS } = require('./world');

const G = buildWorld({ perTrip: 1 }).g;
const S = G.sandbox;
// top-level const in the feeder files is not a sandbox property; read it through run()
S.FD_OUTBOX_HEADERS = G.run('FD_OUTBOX_HEADERS');
S.FD_GCM_TABS = G.run('FD_GCM_TABS');
S.FD_LOG_COLUMNS = G.run('FD_LOG_COLUMNS');

test('manifest: no web app, no entry point, stays a standalone project', () => {
  const root = path.join(__dirname, '..');
  const m = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
  assert.equal(m.webapp, undefined);
  assert.equal(m.timeZone, 'Asia/Kolkata');
  assert.equal(m.runtimeVersion, 'V8');
  assert.ok(!m.oauthScopes.some((s) => /container\.ui|webapp|drive|documents/.test(s)));
  fs.readdirSync(root).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/function\s+do(Get|Post)\b/.test(src), f + ' must not define doGet/doPost');
  });
  assert.ok(!fs.existsSync(path.join(root, '.clasp.json')), 'no .clasp.json: the script ID is TODO(human)');
  assert.ok(fs.existsSync(path.join(root, '.claspignore')));
  assert.ok(fs.existsSync(path.join(root, 'README.md')));
});

test('OUTBOX headers and tab names match the GCM library exactly (emoji included)', () => {
  assert.deepEqual(Array.from(S.FD_OUTBOX_HEADERS), OUTBOX_HEADERS);
  assert.equal(S.FD_GCM_TABS.OUTBOX, '📤 OUTBOX');
  assert.equal(S.FD_GCM_TABS.ROSTER, '🎓 ROSTER');
  assert.equal(S.FD_GCM_TABS.LOG, '📨 MESSAGE LOG');
  assert.equal(S.FD_GCM_TABS.SETTINGS, '⚙️ SETTINGS');
  const libPath = path.join('/Users/dan/Public/PROJECTS/AnitaMethodist/GC-mega-project/library/01_Constants.gs');
  if (!fs.existsSync(libPath)) { return; }   // the real library is not in every checkout
  const lib = fs.readFileSync(libPath, 'utf8');
  const ob = /OUTBOX:\s*\{\s*name:\s*'([^']+)',\s*headers:\s*\[([^\]]+)\]/.exec(lib);
  assert.ok(ob, 'OUTBOX definition found in the library');
  assert.equal(ob[1], S.FD_GCM_TABS.OUTBOX);
  assert.deepEqual(ob[2].split(',').map((x) => x.trim().replace(/^'|'$/g, '')), Array.from(S.FD_OUTBOX_HEADERS));
  ['ROSTER', 'LOG', 'SETTINGS'].forEach((k) => {
    const re = new RegExp((k === 'LOG' ? 'LOG' : k) + ":\\s*\\{\\s*name:\\s*'([^']+)'");
    assert.equal(re.exec(lib)[1], S.FD_GCM_TABS[k], k);
  });
});

test('the transport project still has every column the feeder reads and writes', () => {
  const have = GPS_HEADERS[GPS_SHEETS.NOTIFY_LOG];
  Array.from(S.FD_LOG_COLUMNS).forEach((c) => assert.ok(have.includes(c), 'Parent_Notify_Log has ' + c));
  assert.ok(GPS_HEADERS[GPS_SHEETS.STUDENT_STOPS].includes('gcm_reachable'));
  ['trip_code', 'session', 'vehicle_id', 'active'].forEach((c) => assert.ok(GPS_HEADERS[GPS_SHEETS.TRIPS].includes(c)));
});

test('fdCheckOutboxHeaders_: exact, ordered, trimmed; any drift is refused', () => {
  assert.equal(S.fdCheckOutboxHeaders_(OUTBOX_HEADERS.concat(['Extra'])).ok, true);
  assert.equal(S.fdCheckOutboxHeaders_(OUTBOX_HEADERS.map((h) => ' ' + h + ' ')).ok, true);
  const bad = OUTBOX_HEADERS.slice(); bad[4] = 'Values';
  assert.equal(S.fdCheckOutboxHeaders_(bad).ok, false);
  const swapped = OUTBOX_HEADERS.slice(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.equal(S.fdCheckOutboxHeaders_(swapped).ok, false);
  assert.equal(S.fdCheckOutboxHeaders_(OUTBOX_HEADERS.slice(0, 8)).ok, false);
  assert.equal(S.fdCheckOutboxHeaders_([]).ok, false);
});

test('fdValidValue_: allow-lists, and a URL is refused for every kind', () => {
  const v = (k, x) => S.fdValidValue_(k, x);
  assert.deepEqual({ ...v('bus', 'V07') }, { ok: true, value: 'V07' });
  assert.equal(v('bus', 'evil.com/x').ok, false);
  assert.equal(v('bus', 'https://evil.test').ok, false);
  assert.equal(v('bus', 'www.evil').ok, false);
  assert.equal(v('bus', 'a@b').ok, false);
  assert.equal(v('bus', '').ok, false);
  assert.equal(v('bus', 'x'.repeat(40)).ok, false);
  assert.equal(v('bus', 'Click here\nnow').ok, false);
  assert.equal(v('session', 'MORNING_PICKUP').value, 'Morning pickup');
  assert.equal(v('session', 'Whatever you like').ok, false);
  assert.equal(v('date', '2026-11-19').value, '19 Nov 2026');
  assert.equal(v('date', '19/11/2026').ok, false);
  assert.equal(v('date', '2026-13-01').ok, false);
  assert.equal(v('time', '2026-11-19 10:59:30').value, '10:59');
  assert.equal(v('time', 'soon').ok, false);
  [1, 5, 60, '7'].forEach((x) => assert.equal(v('eta', x).ok, true, String(x)));
  [0, 61, 5.5, '5.5', -1, 'five', '', null, '1e1'].forEach((x) => assert.equal(v('eta', x).ok, false, String(x)));
  assert.equal(v('stop', 'Anna Nagar Roundtana').ok, true);
  assert.equal(v('stop', 'Stop (see bit.ly/abc)').ok, false);
  assert.equal(v('nonsense', 'x').ok, false);
});

test('window: parse, start inclusive, end exclusive, Asia/Kolkata', () => {
  const w = S.fdParseWindow_('07:00-19:00');
  assert.deepEqual({ ...w }, { start: 420, end: 1140 });
  assert.equal(S.fdParseWindow_(''), null);
  assert.equal(S.fdParseWindow_('19:00-07:00'), null);
  assert.equal(S.fdParseWindow_('whenever'), null);
  const at = (h, m) => Date.UTC(2026, 10, 19, h, m) - 330 * 60000;
  assert.equal(S.fdInWindow_(at(6, 59), w), false);
  assert.equal(S.fdInWindow_(at(7, 0), w), true);
  assert.equal(S.fdInWindow_(at(18, 59), w), true);
  assert.equal(S.fdInWindow_(at(19, 0), w), false);
  assert.equal(S.fdInWindow_(at(12, 0), null), false);
});

test('time helpers: heartbeat text is the ISO form the transport watchdog reads', () => {
  assert.equal(S.fdStamp_(NOW), '2026-11-19 11:00:00');
  assert.equal(S.fdIso_(NOW), '2026-11-19T11:00:00+05:30');
  assert.equal(Date.parse(S.fdIso_(NOW)), NOW);
  assert.equal(S.fdCellMs_('2026-11-19 11:00:00'), NOW);
  assert.equal(S.fdCellMs_(new Date(NOW)), NOW);
  assert.equal(S.fdCellMs_('junk'), null);
});

test('fdEvaluateCaps_: per trip run and per day', () => {
  const items = (n, run) => Array.from({ length: n }, () => ({ trip_run_id: run }));
  const base = { queuedByRun: {}, queuedToday: 0, students: { 'T1|MORNING_PICKUP': 40 }, enabledTypes: 2, dailyCap: 300 };
  assert.equal(S.fdEvaluateCaps_(items(80, '2026-11-19|T1'), base).tripped, false);
  const over = S.fdEvaluateCaps_(items(81, '2026-11-19|T1'), base);
  assert.equal(over.tripped, true);
  assert.match(over.reason, /trip run cap: 81 rows for trip T1 against a cap of 80/);
  // rows already queued count against the run
  assert.equal(S.fdEvaluateCaps_(items(10, '2026-11-19|T1'), { ...base, queuedByRun: { '2026-11-19|T1': 71 } }).tripped, true);
  // a trip with no students has a cap of zero
  assert.equal(S.fdEvaluateCaps_(items(1, '2026-11-19|T9'), base).tripped, true);
  // the daily cap
  const day = S.fdEvaluateCaps_(items(1, '2026-11-19|T1'), { ...base, queuedToday: 300 });
  assert.equal(day.tripped, true);
  assert.match(day.reason, /daily cap: 301 rows today against gcm_feed_daily_cap 300/);
  assert.equal(S.fdEvaluateCaps_([], base).tripped, false);
});

test('fdReadSettings_: unknown mode is shadow_local; a bad cap falls back to 300', () => {
  assert.equal(S.fdReadSettings_({ parent_notify_mode: 'LIVE ' }).mode, 'live');
  assert.equal(S.fdReadSettings_({ parent_notify_mode: 'yolo' }).mode, 'shadow_local');
  assert.equal(S.fdReadSettings_({}).mode, 'shadow_local');
  assert.equal(S.fdReadSettings_({ gcm_feed_daily_cap: '12' }).dailyCap, 12);
  ['0', '-3', '2.5', 'many', ''].forEach((x) => assert.equal(S.fdReadSettings_({ gcm_feed_daily_cap: x }).dailyCap, 300));
});

test('fdColumnWrites_: one block per touched column, untouched cells inside keep their value', () => {
  const values = [['a', 'b', 'c'], [1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];
  const w = S.fdColumnWrites_(values, [{ rowNum: 2, set: { a: 'x' } }, { rowNum: 4, set: { a: 'y', c: 'z' } }]);
  assert.equal(w.length, 2);
  const a = w.find((b) => b.col === 1), c = w.find((b) => b.col === 3);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), { col: 1, row: 2, values: [['x'], [4], ['y']] });
  assert.deepEqual(JSON.parse(JSON.stringify(c)), { col: 3, row: 4, values: [['z']] });
  assert.throws(() => S.fdColumnWrites_(values, [{ rowNum: 2, set: { nope: 1 } }]), /sheet header missing: nope/);
});

test('fdPlanReachability_: on ROSTER and not LEFT = Yes; only changes are written', () => {
  const students = [
    { _row: 2, admission_no: 'C00001', gcm_reachable: '' }, { _row: 3, admission_no: 'c00002', gcm_reachable: 'Yes' },
    { _row: 4, admission_no: 'C00003', gcm_reachable: 'Yes' }, { _row: 5, admission_no: 'C00004', gcm_reachable: 'No' },
    { _row: 6, admission_no: '', gcm_reachable: '' }];
  const roster = [{ 'admission no': 'C00001', status: 'ACTIVE' }, { 'admission no': 'C00002', status: 'active' },
    { 'admission no': 'C00003', status: 'LEFT' }];
  const p = S.fdPlanReachability_(students, roster);
  assert.equal(p.yes, 2); assert.equal(p.no, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(p.updates)), [
    { rowNum: 2, set: { gcm_reachable: 'Yes' } }, { rowNum: 4, set: { gcm_reachable: 'No' } }]);
});
