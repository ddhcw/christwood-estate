'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildWorld, NOW, TAB } = require('./world');
const { render } = require('./lib-replica');

const REACHED = 'Bus {{Bus}} reached school at {{Time}} on {{Date}} ({{Session}}).\n{{Shadow Ref?}}';
const LEFT = 'Bus {{Bus}} left school at {{Time}} on {{Date}} ({{Session}}).\n{{Shadow Ref?}}';
const ADM = /C0\d{3,6}/i;

const statuses = (w) => w.logObjs().map((r) => r.status);
const count = (arr, v) => arr.filter((x) => x === v).length;
const ops = (w) => w.g.state.fetches.length;

test('the draft GCM templates carry exactly the bodies these tests render', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'gcm-requests', 'TEMPLATES-rows.md'), 'utf8');
  assert.ok(md.includes(REACHED), 'reached-school body in TEMPLATES-rows.md');
  assert.ok(md.includes(LEFT), 'left-school body in TEMPLATES-rows.md');
});

// ---- R43: one fixture per rule: no OUTBOX row and a logged reason -----------

const RULES = [
  ['type_not_enabled', (w) => w.setSetting('parent_notify_types', 'bus_left_school'), 'suppress'],
  ['no_template', (w) => { w.setSetting('parent_notify_types', 'bus_approaching,bus_reached_school'); const run = '2026-11-19|T1';
    w.setLog(0, { event_type: 'bus_approaching', dedupe_key: run + '|C00001|bus_approaching', event_id: run + '|S1|bus_approaching' }); }, 'suppress'],
  ['session_not_for_type', (w) => w.setLog(0, { session: 'AFTERNOON_DROP' }), 'suppress'],
  ['bad_admission_form', (w) => w.setLog(0, { admission_no: 'X1', dedupe_key: '2026-11-19|T1|X1|bus_reached_school' }), 'suppress'],
  ['bad_trip_run_id', (w) => w.setLog(0, { trip_run_id: '=1|T1' }), 'suppress'],
  ['bad_dedupe_key', (w) => w.setLog(0, { dedupe_key: 'something else' }), 'suppress'],
  ['bad_event_id', (w) => w.setLog(0, { event_id: 'hello' }), 'suppress'],
  ['run_not_today', (w) => w.setLog(0, { trip_run_id: '2026-11-18|T1', service_date: '2026-11-18',
    dedupe_key: '2026-11-18|T1|C00001|bus_reached_school', event_id: '2026-11-18|T1|SCH|bus_reached_school' }), 'suppress'],
  ['trip_unknown', (w) => w.setLog(0, { trip_run_id: '2026-11-19|T9', dedupe_key: '2026-11-19|T9|C00001|bus_reached_school', event_id: '2026-11-19|T9|SCH|bus_reached_school' }), 'suppress'],
  ['trip_inactive', (w) => { w.trips.data[1][6] = 'No'; }, 'suppress'],
  ['session_mismatch', (w) => { w.trips.data[1][1] = 'AFTERNOON_DROP'; }, 'suppress'],
  ['mode_changed', (w) => w.setLog(0, { mode: 'live' }), 'suppress'],
  ['no_active_student_row', (w) => { w.students.data.splice(1, 1); }, 'suppress'],
  ['notify_off', (w) => { const h = w.students.data[0]; w.students.data[1][h.indexOf('notify')] = 'No'; }, 'suppress'],
  ['no_active_student_row', (w) => { const h = w.students.data[0]; w.students.data[1][h.indexOf('active')] = 'No'; }, 'suppress'],
  ['vehicle_unknown', (w) => { w.vehicles.data.splice(1, 1); }, 'suppress'],
  ['url_in_bus', (w) => { w.trips.data[1][3] = 'evil.example/x'; w.vehicles.data[1][0] = 'evil.example/x'; }, 'suppress'],
  ['no_expires_at', (w) => w.setLog(0, { expires_at: '' }), 'suppress'],
  ['expired_before_feed', (w) => w.setLog(0, { expires_at: NOW - 1000 }), 'expired'],
  ['outside_send_window', () => {}, 'wait', 20 * 3600000],      // 31 Nov-style trick avoided: shifted below
  ['no_shadow_space', (w) => { w.props.GCM_SHADOW_SPACE = 'not a space'; }, 'wait'],
  ['live_not_allowed', (w) => { w.setSetting('parent_notify_mode', 'live'); w.setLog(0, { mode: 'live' }); }, 'wait'],
  ['not_reachable_by_gcm', (w) => { w.setSetting('parent_notify_mode', 'live'); w.setLog(0, { mode: 'live' }); w.props.FEED_LIVE_ALLOWED = 'Yes';
    const h = w.students.data[0]; w.students.data[1][h.indexOf('gcm_reachable')] = 'No'; }, 'suppress']
];

RULES.forEach(([reason, mutate, outcome, shift]) => {
  test('R43 fixture: ' + reason + ' -> no OUTBOX row, reason logged', () => {
    const w = buildWorld({ perTrip: 1 });
    mutate(w);
    let now = NOW;
    if (reason === 'outside_send_window') now = Date.UTC(2026, 10, 19, 15, 0, 0);   // 20:30 IST; row not yet expired below
    if (reason === 'outside_send_window') w.setLog(0, { expires_at: now + 600000, created_at: '2026-11-19 20:29:30' });
    const r = w.run(now);
    assert.equal(r.status, 'ok');
    assert.equal(w.outboxCount(), 0, 'nothing appended');
    assert.equal(w.outbox.writes.length, 0, 'OUTBOX never written');
    const row = w.logObjs()[0];
    if (outcome === 'suppress') {
      assert.equal(row.status, 'suppressed');
      assert.equal(row.suppressed_reason, 'feed_guard:' + reason);
    } else if (outcome === 'expired') {
      assert.equal(row.status, 'expired');
      assert.equal(row.suppressed_reason, reason);
    } else {
      assert.equal(row.status, 'pending_feed', 'a row that may pass later stays pending');
      assert.ok(w.g.state.logs.some((l) => l.includes(reason + '=1')), 'reason is logged: ' + w.g.state.logs.join('|'));
    }
    assert.ok(!w.g.state.logs.join('\n').match(ADM), 'no admission number in the run log');
  });
});

test('R43: a project id other than cw-bus-notify blocks the feed and alerts once', () => {
  const w = buildWorld({ perTrip: 3 });
  w.setSetting('gcm_project_id', 'some-other-project');
  w.run(); w.run();
  assert.equal(w.outboxCount(), 0);
  assert.deepEqual(statuses(w), ['pending_feed', 'pending_feed', 'pending_feed']);
  assert.equal(ops(w), 1, 'one alert across two runs');
});

test('R43: a duplicate dedupe_key is queued once; a key already queued is never queued again', () => {
  const w = buildWorld({ perTrip: 2 });
  w.log.data.push(w.log.data[1].slice());          // an exact duplicate of row 1
  w.run();
  assert.equal(w.outboxCount(), 2, 'one row per distinct key');
  const rows = w.logObjs();
  assert.equal(count(rows.map((r) => r.status), 'queued_gcm'), 2);
  assert.equal(rows[2].status, 'suppressed');
  assert.equal(rows[2].suppressed_reason, 'feed_guard:duplicate_dedupe_key');
  // a fresh pending row whose key is already in the log as sent
  const w2 = buildWorld({ perTrip: 1 });
  const dup = w2.log.data[1].slice(); w2.log.data[1][w2.log.data[0].indexOf('status')] = 'sent';
  w2.log.data.push(dup);
  w2.run();
  assert.equal(w2.outboxCount(), 0);
  assert.equal(w2.logObjs()[1].suppressed_reason, 'feed_guard:duplicate_dedupe_key');
});

test('R43: modes that do not feed queue nothing (shadow_local, off, unknown), but expiry still runs', () => {
  ['shadow_local', 'off', 'nonsense'].forEach((mode) => {
    const w = buildWorld({ perTrip: 2, mode });
    w.setSetting('parent_notify_mode', mode);
    w.setLog(1, { status: 'pending_feed', expires_at: NOW - 5 });
    w.run();
    assert.equal(w.outboxCount(), 0, mode);
    assert.deepEqual(statuses(w), ['pending_feed', 'expired'], mode);
  });
});

// ---- Caps and the guard ------------------------------------------------------

test('forged log of 500 rows trips the daily cap: nothing queued, one alert, stays tripped until reset', () => {
  const w = buildWorld({ trips: 10, perTrip: 50, dailyCap: 300 });
  assert.equal(w.logObjs().length, 500);
  const r = w.run();
  assert.equal(r.tripped, true);
  assert.equal(w.outboxCount(), 0);
  assert.equal(w.outbox.writes.length, 0);
  assert.equal(count(statuses(w), 'pending_feed'), 500, 'nothing was marked queued');
  assert.ok(w.props.FEED_GUARD_TRIPPED, 'tripped flag set');
  assert.match(JSON.parse(w.props.FEED_GUARD_TRIPPED).reason, /daily cap: 500 rows today against gcm_feed_daily_cap 300/);
  assert.equal(ops(w), 1);
  // later runs: still nothing, no second alert, even after the cap setting is raised
  w.setSetting('gcm_feed_daily_cap', '5000');
  w.run(NOW + 60000); w.run(NOW + 120000);
  assert.equal(w.outboxCount(), 0);
  assert.equal(ops(w), 1, 'the same trip is not alerted again');
  // a person resets from the menu; the feeder then resumes
  w.g.run('menuResetFeedGuard()');
  assert.equal(w.props.FEED_GUARD_TRIPPED, undefined);
  w.run(NOW + 180000);
  assert.equal(w.outboxCount(), 500);
});

test('the trip run cap trips even when every row passed the guard', () => {
  const w = buildWorld({ perTrip: 2 });
  // 4 rows already counted as queued for this run, 2 pending now: 6 against a cap of 2 students x 2 types
  for (let i = 0; i < 4; i++) {
    const row = w.log.data[1].slice();
    row[w.log.data[0].indexOf('status')] = 'sent'; row[w.log.data[0].indexOf('gcm_queued_at')] = '2026-11-19 10:00:00';
    row[w.log.data[0].indexOf('dedupe_key')] = 'k' + i;
    w.log.data.push(row);
  }
  const r = w.run();
  assert.equal(r.tripped, true);
  assert.equal(w.outboxCount(), 0);
  assert.match(JSON.parse(w.props.FEED_GUARD_TRIPPED).reason, /trip run cap: 6 rows for trip T1 against a cap of 4/);
});

test('real traffic does not trip: 40 students, one event type, well inside both caps', () => {
  const w = buildWorld({ perTrip: 40 });
  const r = w.run();
  assert.equal(r.tripped, false);
  assert.equal(r.queued, 40);
  assert.equal(w.props.FEED_GUARD_TRIPPED, undefined);
});

// ---- Modes (R37) ---------------------------------------------------------------

test('shadow_gcm: 40 rows go in ONE batch, every Recipient is the shadow space, 40 distinct bodies', () => {
  const w = buildWorld({ perTrip: 40 });
  w.run();
  assert.equal(w.outboxCount(), 40);
  assert.deepEqual(w.outbox.writes, [[2, 1, 40, 9]], 'one setValues for the whole event');
  assert.ok(w.g.state.lockCalls >= 1 && w.g.state.locksHeld === 0, 'lock taken and released');
  const rows = w.outboxObjs();
  rows.forEach((r) => {
    assert.equal(r['Project ID'], 'cw-bus-notify');
    assert.equal(r['Recipient'], 'spaces/AAAA_shadow');
    assert.equal(r['Template ID'], 'cw-bus-reached-school');
    assert.equal(r['Send After'], '');
    assert.equal(r['Status'], 'READY');
    assert.equal(r['Result'], ''); assert.equal(r['Hash'], '');
    assert.ok(r['Queued At'] instanceof Date);
    assert.ok(!ADM.test(r['Recipient']) && !ADM.test(r['Values (JSON)']), 'no admission number in a shadow row');
  });
  const bodies = rows.map((r) => render(REACHED, r['Values (JSON)']));
  assert.equal(new Set(bodies).size, 40, '40 distinct bodies (so 40 distinct GCM hashes)');
  bodies.forEach((b) => {
    assert.match(b, /^Bus V01 reached school at 10:59 on 19 Nov 2026 \(Morning pickup\)\.\nshadow \d{5} 2026-11-19\|T1\|SCH\|bus_reached_school$/);
  });
  // log rows marked
  const log = w.logObjs();
  assert.equal(count(statuses(w), 'queued_gcm'), 40);
  log.forEach((r) => { assert.equal(r.gcm_queued_at, '2026-11-19 11:00:00'); assert.equal(r.gcm_status, 'READY'); assert.match(r.gcm_result, /^ref:[0-9a-f]{14}$/); });
});

test('shadow counter keeps rising across runs, so a later batch never repeats an earlier body', () => {
  const w = buildWorld({ perTrip: 3 });
  w.run();
  // three late rows for the same event
  const head = w.log.data[0];
  for (let i = 0; i < 3; i++) {
    const row = w.log.data[1].slice(); const adm = 'C09' + i + '00';
    row[head.indexOf('admission_no')] = adm; row[head.indexOf('dedupe_key')] = '2026-11-19|T1|' + adm + '|bus_reached_school';
    row[head.indexOf('status')] = 'pending_feed'; row[head.indexOf('gcm_queued_at')] = ''; row[head.indexOf('gcm_result')] = ''; row[head.indexOf('gcm_status')] = '';
    w.log.data.push(row);
    const sh = w.students.data[0]; const st = w.students.data[1].slice(); st[sh.indexOf('admission_no')] = adm; w.students.data.push(st);
  }
  w.run(NOW + 60000);
  assert.equal(w.outboxCount(), 6);
  const bodies = w.outboxObjs().map((r) => render(REACHED, r['Values (JSON)']));
  assert.equal(new Set(bodies).size, 6);
});

test('re-running changes nothing (idempotent)', () => {
  const w = buildWorld({ perTrip: 5 });
  w.run();
  const before = JSON.stringify([w.outbox.data, w.log.data]);
  const r = w.run(NOW + 30000);
  assert.equal(r.queued, 0);
  assert.equal(JSON.stringify([w.outbox.data, w.log.data]), before);
});

test('live with FEED_LIVE_ALLOWED=No: no admission number is written anywhere, rows wait', () => {
  const w = buildWorld({ perTrip: 5, mode: 'live' });
  const r = w.run();
  assert.equal(w.outboxCount(), 0);
  assert.equal(w.outbox.writes.length, 0);
  assert.equal(count(statuses(w), 'pending_feed'), 5);
  assert.equal(r.waiting, 5);
});

test('live with both switches: Recipient is the admission number, never a space, no Shadow Ref line', () => {
  const w = buildWorld({ perTrip: 5, mode: 'live', props: { FEED_LIVE_ALLOWED: 'Yes' } });
  w.run();
  assert.equal(w.outboxCount(), 5);
  w.outboxObjs().forEach((r) => {
    assert.match(r['Recipient'], /^C0\d{4}$/);
    assert.ok(!r['Recipient'].startsWith('spaces/'));
    assert.equal(JSON.parse(r['Values (JSON)'])['Shadow Ref'], undefined);
    const body = render(REACHED, r['Values (JSON)']);
    assert.equal(body, 'Bus V01 reached school at 10:59 on 19 Nov 2026 (Morning pickup).', 'the empty optional line is dropped');
  });
});

test('live: a student the ROSTER pre-check has not cleared gets nothing (and is logged)', () => {
  const w = buildWorld({ perTrip: 3, mode: 'live', props: { FEED_LIVE_ALLOWED: 'Yes' } });
  const h = w.students.data[0]; w.students.data[2][h.indexOf('gcm_reachable')] = 'No';
  w.run();
  assert.equal(w.outboxCount(), 2);
  assert.equal(w.logObjs()[1].suppressed_reason, 'feed_guard:not_reachable_by_gcm');
});

test('left-school events use their own template and fit only afternoon and evening runs', () => {
  const w = buildWorld({ perTrip: 1 });
  w.trips.data[1][1] = 'AFTERNOON_DROP';
  const run = '2026-11-19|T1', h = w.log.data[0];
  w.setLog(0, { session: 'AFTERNOON_DROP', event_type: 'bus_left_school', dedupe_key: run + '|C00001|bus_left_school', event_id: run + '|SCH|bus_left_school' });
  w.students.data[1][w.students.data[0].indexOf('session')] = 'AFTERNOON_DROP';
  w.run();
  assert.equal(w.outboxCount(), 1);
  const row = w.outboxObjs()[0];
  assert.equal(row['Template ID'], 'cw-bus-left-school');
  assert.match(render(LEFT, row['Values (JSON)']), /^Bus V01 left school at 10:59 on 19 Nov 2026 \(Afternoon drop\)\./);
  assert.ok(h.length > 0);
});

// ---- OUTBOX is append-only -----------------------------------------------------

test('existing OUTBOX rows are never edited: only rows after the last one are written', () => {
  const w = buildWorld({ perTrip: 4 });
  const existing = [
    [new Date(NOW - 86400000), 'other-project', 'C09999', 't', '{}', '', 'SENT', 'ok', 'a'.repeat(32)],
    [new Date(NOW - 3600000), 'other-project', 'C09998', 't', '{}', '', 'READY', '', ''],
    [new Date(NOW - 60000), 'cw-bus-notify', 'spaces/old', 'cw-bus-reached-school', '{"Bus":"V01"}', '', 'ERROR', 'boom', '']];
  existing.forEach((r) => w.outbox.data.push(r.slice()));
  const snap = JSON.stringify(w.outbox.data.slice(0, 4));
  w.run();
  assert.equal(JSON.stringify(w.outbox.data.slice(0, 4)), snap);
  assert.equal(w.outboxCount(), 3 + 4);
  assert.deepEqual(w.outbox.writes, [[5, 1, 4, 9]]);
});

test('changed OUTBOX headers: nothing is written, rows stay pending, one alert', () => {
  const w = buildWorld({ perTrip: 3 });
  w.outbox.data[0][4] = 'Values';
  w.run(); w.run(NOW + 60000);
  assert.equal(w.outbox.writes.length, 0);
  assert.deepEqual(statuses(w), ['pending_feed', 'pending_feed', 'pending_feed']);
  assert.equal(ops(w), 1);
  assert.match(w.g.state.fetches[0].payload, /OUTBOX headers changed/);
});

test('an unusable SEND_WINDOW in GCM SETTINGS blocks the feed (fails closed)', () => {
  const w = buildWorld({ perTrip: 2 });
  w.ctl.sheets[TAB.SETTINGS].data[1][1] = '';
  w.run();
  assert.equal(w.outboxCount(), 0);
  assert.deepEqual(statuses(w), ['pending_feed', 'pending_feed']);
  assert.equal(ops(w), 1);
});

test('GCM unreachable or feeder stopped: rows stay pending_feed, nothing reaches GCM', () => {
  const stopped = buildWorld({ perTrip: 3 });          // the feeder never runs
  assert.deepEqual(statuses(stopped), ['pending_feed', 'pending_feed', 'pending_feed']);
  assert.equal(stopped.outboxCount(), 0);
  const w = buildWorld({ perTrip: 3, props: { GCM_CONTROL_SHEET_ID: 'MISSING' } });
  const r = w.run(); w.run(NOW + 60000);
  assert.equal(r.status, 'ok');
  assert.deepEqual(statuses(w), ['pending_feed', 'pending_feed', 'pending_feed']);
  assert.equal(w.outboxCount(), 0);
  assert.equal(ops(w), 1, 'one alert, not one per minute');
});

test('append failure: rows are put back to pending_feed, never left half-queued, and it is alerted', () => {
  const w = buildWorld({ perTrip: 3 });
  w.outbox.failWrites = true;
  w.run();
  assert.deepEqual(statuses(w), ['pending_feed', 'pending_feed', 'pending_feed']);
  w.logObjs().forEach((r) => { assert.equal(r.gcm_queued_at, ''); assert.equal(r.gcm_result, ''); });
  assert.equal(ops(w), 1);
  w.outbox.failWrites = false;
  const r = w.run(NOW + 60000);
  assert.equal(r.queued, 3, 'it recovers on the next run');
});

test('a busy lock skips the run and writes nothing', () => {
  const w = buildWorld({ perTrip: 3 });
  w.g.state.lockBusy = true;
  const r = w.run();
  assert.equal(r.status, 'busy');
  assert.equal(w.outboxCount(), 0);
  assert.deepEqual(statuses(w), ['pending_feed', 'pending_feed', 'pending_feed']);
});

// ---- Heartbeat -------------------------------------------------------------------

test('heartbeat: written as ISO time with +05:30, added once and then updated in place', () => {
  const w = buildWorld({ perTrip: 1 });
  w.run();
  const rows = () => w.settings.data.filter((r) => r[0] === 'feeder_heartbeat');
  assert.equal(rows().length, 1);
  assert.equal(rows()[0][1], '2026-11-19T11:00:00+05:30');
  assert.ok(/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(rows()[0][1]), 'the watchdog accepts this form');
  w.run(NOW + 120000);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0][1], '2026-11-19T11:02:00+05:30');
});

// ---- Reconcile (R39) ----------------------------------------------------------------

function queued4() {
  const w = buildWorld({ perTrip: 4 });
  w.run();
  return w;
}
const setOb = (w, i, patch) => { Object.keys(patch).forEach((k) => { w.outbox.data[i + 1][w.outbox.data[0].indexOf(k)] = patch[k]; }); };

test('reconcile copies GCM status back; READY stays queued; ONE alert for the trip run', () => {
  const w = queued4();
  setOb(w, 0, { Status: 'SENT', Hash: 'a'.repeat(32) });
  setOb(w, 1, { Status: 'SKIPPED', Result: 'duplicate within dedupe window', Hash: 'b'.repeat(32) });
  setOb(w, 2, { Status: 'ERROR', Result: 'HTTP 403 from Chat' });
  // row 3 stays READY
  const r = w.run(NOW + 75000);
  assert.equal(r.reconciled, 3);
  const rows = w.logObjs();
  assert.deepEqual(rows.map((x) => x.status), ['sent', 'skipped', 'failed', 'queued_gcm']);
  assert.deepEqual(rows.map((x) => x.gcm_status), ['SENT', 'SKIPPED', 'ERROR', 'READY']);
  assert.equal(rows[0].gcm_sent_at, '2026-11-19 11:01:15');
  assert.equal(rows[0].latency_s, 75);
  assert.match(rows[0].gcm_result, /hash:a{32}/);
  assert.match(rows[1].gcm_result, /duplicate within dedupe window/);
  assert.match(rows[2].gcm_result, /HTTP 403/);
  assert.equal(rows[3].gcm_sent_at, '');
  assert.equal(ops(w), 1, 'one Ops Alert for the run, not one per row');
  assert.match(w.g.state.fetches[0].payload, /2026-11-19\|T1: 1 skipped, 1 failed/);
  assert.ok(!ADM.test(w.g.state.fetches[0].payload), 'no student identifier in the alert');
  // later runs repeat nothing
  setOb(w, 3, { Status: 'ERROR', Result: 'late failure' });
  w.run(NOW + 135000);
  assert.equal(w.logObjs()[3].status, 'failed');
  assert.equal(ops(w), 1, 'still one alert for the same trip run');
});

test('reconcile: a vanished OUTBOX row is reported MISSING after 10 minutes', () => {
  const w = queued4();
  const gone = w.outbox.data.splice(2, 1)[0];
  assert.ok(gone);
  w.run(NOW + 5 * 60000);
  assert.equal(count(statuses(w), 'failed'), 0);
  w.run(NOW + 11 * 60000);
  assert.equal(count(statuses(w), 'failed'), 1);
  assert.equal(w.logObjs().find((r) => r.status === 'failed').gcm_status, 'MISSING');
  assert.equal(ops(w), 1);
});

test('reconcile: CANCELLED maps to skipped; an unknown GCM status leaves the row queued', () => {
  const w = buildWorld({ perTrip: 2 });
  w.run();
  setOb(w, 0, { Status: 'CANCELLED', Result: 'cancelled by a person' });
  setOb(w, 1, { Status: 'WEIRD' });
  w.run(NOW + 60000);
  assert.deepEqual(statuses(w), ['skipped', 'queued_gcm']);
  assert.equal(w.logObjs()[1].gcm_status, 'WEIRD');
});

test('nightly: MESSAGE LOG gives the true send time and the authoritative status; ROSTER pre-check writes gcm_reachable', () => {
  const w = queued4();
  setOb(w, 0, { Status: 'SENT', Hash: 'a'.repeat(32) });
  setOb(w, 1, { Status: 'SENT', Hash: 'b'.repeat(32) });
  w.run(NOW + 30000);
  assert.equal(w.logObjs()[0].gcm_sent_at, '2026-11-19 11:00:30');
  const log = w.ctl.sheets[TAB.LOG];
  log.data.push([new Date(NOW + 95000), 'cw-bus-notify', 'OUTBOX', 'spaces/AAAA_shadow', 'spaces/AAAA_shadow', 'SENT', 'ok', 'a'.repeat(32), 'x']);
  log.data.push([new Date(NOW + 100000), 'cw-bus-notify', 'OUTBOX', 'spaces/AAAA_shadow', 'spaces/AAAA_shadow', 'FAILED', 'quota', 'b'.repeat(32), 'x']);
  // ROSTER: C0001 ACTIVE, C0002 LEFT, C0003 missing, C0004 ACTIVE
  const roster = w.ctl.sheets[TAB.ROSTER];
  roster.data[2][5] = 'LEFT'; roster.data.splice(3, 1);
  const r = w.nightly(NOW + 3600000);
  assert.equal(r.status, 'ok');
  const rows = w.logObjs();
  assert.equal(rows[0].status, 'sent');
  assert.equal(rows[0].gcm_sent_at, '2026-11-19 11:01:35');
  assert.equal(rows[0].latency_s, 95);
  assert.match(rows[0].gcm_result, /confirmed in MESSAGE LOG/);
  assert.equal(rows[1].status, 'failed');
  assert.equal(rows[1].gcm_status, 'FAILED');
  assert.equal(ops(w), 1, 'the log-detected failure alerts once for the run');
  const h = w.students.data[0], col = h.indexOf('gcm_reachable');
  assert.deepEqual(w.students.data.slice(1).map((x) => x[col]), ['Yes', 'No', 'No', 'Yes']);
  assert.equal(w.props.FEED_LAST_NIGHTLY, '2026-11-19');
  // only the one column was written on Student_Trip_Stops
  assert.ok(w.students.writes.every((x) => x[1] === col + 1 && x[3] === 1));
});

test('nightly refuses (and alerts once) when a workbook cannot be opened', () => {
  const w = buildWorld({ perTrip: 1, props: { GCM_CONTROL_SHEET_ID: 'NOPE' } });
  assert.equal(w.nightly().status, 'refused');
  w.nightly();
  assert.equal(ops(w), 1);
});

// ---- Alerts and menu --------------------------------------------------------------

test('Ops Alerts: retries on 5xx, then falls back to email; never logs the webhook', () => {
  let calls = 0;
  const w = buildWorld({ perTrip: 1, fetch: () => { calls++; return { status: 503 }; } });
  w.setSetting('gcm_project_id', 'x');
  w.run();
  assert.equal(calls, 3);
  assert.equal(w.g.state.sleeps.length, 2);
  assert.equal(w.g.state.mails.length, 1);
  assert.ok(!w.g.state.logs.join('\n').includes('chat.example.test'));
});

test('an alert that could not be delivered is retried on the next run (honest state)', () => {
  const w = buildWorld({ perTrip: 1, props: { OPS_ALERTS_WEBHOOK: '' } });
  w.setSetting('gcm_project_id', 'x');
  w.g.sandbox.MailApp.sendEmail = () => { throw new Error('mail down'); };
  w.run();
  assert.equal(w.props.FEED_ALERT_STATE, undefined);
  w.g.sandbox.MailApp.sendEmail = (m) => { w.g.state.mails.push(m); };
  w.run(NOW + 60000);
  assert.equal(w.g.state.mails.length, 1);
});

test('menu: install triggers is idempotent; feederRun never throws', () => {
  const w = buildWorld({ perTrip: 1 });
  w.g.run('menuInstallTriggers()'); w.g.run('menuInstallTriggers()');
  assert.deepEqual(w.g.state.triggers.map((t) => t.fn).sort(), ['feederNightly', 'feederRun']);
  assert.equal(w.g.state.triggers.find((t) => t.fn === 'feederRun').minutes, 1);
  const bad = buildWorld({ perTrip: 1, props: { TRANSPORT_WORKBOOK_ID: '' } });
  const r = bad.g.run('feederRun()');
  assert.equal(r.status, 'refused');
  const w2 = buildWorld({ perTrip: 1 });
  w2.wb.sheets['Parent_Notify_Log'].getRange = () => { throw new Error('quota exceeded'); };
  assert.equal(w2.g.run('feederRun()').status, 'error');
});
