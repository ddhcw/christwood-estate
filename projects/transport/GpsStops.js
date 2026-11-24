/**
 * GpsStops.js — stop import and capture tool (PRD rev 4 R27, R30, R41; ticket G-F / T15).
 *
 * Four jobs (R30), all manage-only (R41, RFC-GPS-5):
 *   1. import      gpsImportStops(apply)       school stop sheet -> Transport_Stops, Trip_Stops,
 *                                              Student_Trip_Stops. Header-agnostic (Q12 is open):
 *                                              the Stop_Import_Map tab maps logical fields to the
 *                                              school sheet's real headers. apply !== true = dry run.
 *   2. mark        gpsMarkStop(stop, vehicle, overwrite)   saves the BUS PHONE's latest fix
 *   3. map tap     gpsTapStop(stop, lat, lon, overwrite)
 *   4. dwell       getGpsDwell(vehicle, date) + gpsSaveDwellDraft(...)   suggestions only
 *   plus           getGpsStops()               list for the page
 *
 * Every server function begins with gpsRequire_('manage') and returns the bare refusal on
 * failure. Stop coordinates are effectively home addresses (PRD §9), so nothing here is
 * readable by a 'view' role. Every save writes one GPS_Access_Log row BEFORE the sheet is
 * touched and is refused if that row cannot be written (the old values go in the row).
 *
 * Layout: 1. constants  2. pure logic (unit-tested)  3. Apps Script glue.
 * Functions ending in "_" cannot be called from google.script.run.
 */

// ---- 1. Constants ----------------------------------------------------------

/** Mark this stop: reject a bus fix older than this or less accurate than this (R30 job 2). */
const GPS_MARK_MAX_AGE_S = 60;
const GPS_MARK_MAX_ACCURACY_M = 50;
/** Dwell suggestions (R30 job 4). */
const GPS_DWELL_MIN_SEC = 20;
const GPS_DWELL_RADIUS_M = 30;
/** A silence longer than this inside a cluster ends it: a dead phone is not a stop. */
const GPS_DWELL_MAX_GAP_S = 120;
const GPS_DWELL_MAX_RESULTS = 50;
const GPS_IMPORT_REPORT_LIMIT = 200;
const GPS_IMPORT_TEXT_MAX = 120;
const GPS_STOP_DEFAULT_RADIUS_M = 75;
const GPS_STOP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const GPS_SHEET_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;
const GPS_STOP_LOCK_MS = 15000;

// ---- 2. Pure logic ---------------------------------------------------------

/** Stop identity: lower case, trimmed, runs of white space collapsed. */
function gpsNormStopName_(v) {
  return gpsStr_(v).toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Text that will be written to a Sheet: control characters out, trimmed, no leading
 * = + - @ (a Sheet would read those as a formula), clamped.
 */
function gpsCleanText_(v, max) {
  var s = gpsStr_(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[=+\-@\s]+/, '');
  return s.slice(0, max || GPS_IMPORT_TEXT_MAX);
}

/**
 * Admission number -> 'C0nnnnn', or '' when it cannot be read. Accepts C0nnnnn in any case,
 * five bare digits (a spreadsheet may have dropped "C0") and six digits starting with 0.
 */
function gpsNormAdmission_(v) {
  var s = gpsStr_(v).replace(/\s+/g, '').toUpperCase();
  if (/^C0\d{5}$/.test(s)) return s;
  if (/^\d{5}$/.test(s)) return 'C0' + s;
  if (/^0\d{5}$/.test(s)) return 'C' + s;
  return '';
}

/** Free text -> one of the three session codes, or ''. */
function gpsNormSession_(v) {
  var s = gpsStr_(v).toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!s) return '';
  if (s === 'morning pickup' || s === 'morning' || s === 'pickup' || s === 'pick up' || s === 'am') return 'MORNING_PICKUP';
  if (s === 'afternoon drop' || s === 'afternoon' || s === 'noon drop') return 'AFTERNOON_DROP';
  if (s === 'evening drop' || s === 'evening' || s === 'drop' || s === 'pm') return 'EVENING_DROP';
  return '';
}

/**
 * Stop_Import_Map rows -> { fields: {logical: sourceHeader|null}, missing: [logical...] }.
 * For each logical field the source_header is tried first, then each alias, all compared
 * ignoring case and repeated spaces against the headers actually in the source sheet.
 */
function gpsResolveImportMap_(headers, mapRows) {
  var byNorm = {};
  (headers || []).forEach(function (h) {
    var k = gpsNormStopName_(h);
    if (k && byNorm[k] === undefined) byNorm[k] = String(h);
  });
  var fields = {};
  GPS_IMPORT_FIELDS.forEach(function (f) { fields[f] = null; });
  (mapRows || []).forEach(function (m) {
    var f = gpsStr_(m.logical_field);
    if (GPS_IMPORT_FIELDS.indexOf(f) < 0 || fields[f]) return;
    var cands = [gpsStr_(m.source_header)].concat(gpsStr_(m.aliases).split(/[|\n]/));
    for (var i = 0; i < cands.length; i++) {
      var hit = byNorm[gpsNormStopName_(cands[i])];
      if (cands[i] && hit !== undefined) { fields[f] = hit; break; }
    }
  });
  return { fields: fields, missing: GPS_IMPORT_FIELDS.filter(function (f) { return !fields[f]; }) };
}

function gpsRouteKey_(v) { return gpsStr_(v).toLowerCase().replace(/\s+/g, ''); }

/**
 * R30 job 1, pure half. rows = source rows as {header: value, _row}. map = Stop_Import_Map
 * rows. opts = { headers, trips } where trips = Transport_Trips rows (route_no + session ->
 * trip_code; only active trips are used). Returns
 *   { stops:[{key, stop_name, landmark}],
 *     tripStops:[{trip_code, sequence, stop_key, scheduled_time}],
 *     studentStops:[{admission_no, session, trip_code, stop_key}],
 *     unmapped:[{row, reason}], mapping, missing }
 * Nothing is dropped silently: a row that cannot be used in full gets an unmapped entry.
 * Student stops hold no names, only the admission number.
 */
function parseStopImport(rows, map, opts) {
  opts = opts || {};
  rows = rows || [];
  var headers = opts.headers || (rows.length ? Object.keys(rows[0]).filter(function (k) { return k !== '_row'; }) : []);
  var resolved = gpsResolveImportMap_(headers, map);
  var f = resolved.fields;
  var out = { stops: [], tripStops: [], studentStops: [], unmapped: [], mapping: f, missing: resolved.missing };

  if (!f.stop_name && !f.admission_no) {
    rows.forEach(function (r) {
      out.unmapped.push({ row: r._row || 0, reason: 'Stop_Import_Map has no match for stop_name or admission_no in the source headers' });
    });
    return out;
  }

  var tripByKey = {};
  (opts.trips || []).forEach(function (t) {
    if (gpsIsOff_(t.active)) return;
    var code = gpsStr_(t.trip_code), sess = gpsStr_(t.session), rt = gpsRouteKey_(t.route_no);
    if (code && sess && rt && !tripByKey[sess + '|' + rt]) tripByKey[sess + '|' + rt] = code;
  });

  var stopSeen = {}, tripSeen = {}, studentSeen = {};
  function val(r, field) { return f[field] ? r[f[field]] : ''; }
  function addStop(name, landmark) {
    var key = gpsNormStopName_(name);
    if (!key) return '';
    if (!stopSeen[key]) {
      stopSeen[key] = true;
      out.stops.push({ key: key, stop_name: name, landmark: landmark || '' });
    }
    return key;
  }

  rows.forEach(function (r) {
    var n = r._row || 0;
    function bad(reason) { out.unmapped.push({ row: n, reason: reason }); }
    var name = gpsCleanText_(val(r, 'stop_name'));
    var adm = gpsStr_(val(r, 'admission_no'));
    if (!name && !adm) { bad('Row has no stop name and no admission number'); return; }
    var route = gpsStr_(val(r, 'route_no')), sessRaw = gpsStr_(val(r, 'session')), seqRaw = gpsStr_(val(r, 'sequence'));
    var session = gpsNormSession_(sessRaw);
    var tripCode = (session && route) ? (tripByKey[session + '|' + gpsRouteKey_(route)] || '') : '';

    var stopKey = name ? addStop(name, gpsCleanText_(val(r, 'landmark'))) : '';

    // Trip stop: only when the row says it is a trip row (a sequence, or a stop row with a route).
    if (name && (seqRaw || (!adm && route))) {
      var seq = Number(seqRaw);
      var why = '';
      if (!route) why = 'route number is blank';
      else if (!session) why = sessRaw ? 'session "' + gpsClampStr_(sessRaw, 30) + '" is not morning pickup, afternoon drop or evening drop' : 'session is blank';
      else if (!tripCode) why = 'no active trip on Transport_Trips for route ' + gpsClampStr_(route, 20) + ' and ' + session;
      else if (seqRaw === '' || !isFinite(seq) || seq < 1 || Math.floor(seq) !== seq) why = 'sequence is not a whole number from 1';
      if (why) bad('Stop "' + name + '" is listed but not added to a trip: ' + why);
      else {
        var tk = tripCode + '|' + stopKey;
        if (!tripSeen[tk]) {
          tripSeen[tk] = true;
          var hm = gpsStr_(val(r, 'scheduled_time'));
          var mins = hm === '' ? null : gpsParseHm_(hm);
          if (hm !== '' && mins === null) bad('Stop "' + name + '": scheduled time "' + gpsClampStr_(hm, 20) + '" is not HH:mm, left blank');
          out.tripStops.push({ trip_code: tripCode, sequence: seq, stop_key: stopKey,
            scheduled_time: mins === null ? '' : gpsPad2_(Math.floor(mins / 60)) + ':' + gpsPad2_(mins % 60) });
        }
      }
    }

    // Student stop.
    if (adm) {
      var an = gpsNormAdmission_(adm);
      if (!an) { bad('Admission number is not in C0nnnnn form, not imported'); return; }
      var sName = gpsCleanText_(val(r, 'student_stop')) || name;
      if (!sName) { bad('Student ' + an + ' has no stop name'); return; }
      if (!session) { bad('Student ' + an + ': session ' + (sessRaw ? 'is not recognised' : 'is blank')); return; }
      if (!tripCode) { bad('Student ' + an + ': no active trip on Transport_Trips for that route and session'); return; }
      var sKey = addStop(sName, '');
      var sk = an + '|' + session;
      if (studentSeen[sk] !== undefined) {
        if (studentSeen[sk] !== sKey) bad('Student ' + an + ' appears twice for ' + session + ' with different stops, first one kept');
        return;
      }
      studentSeen[sk] = sKey;
      out.studentStops.push({ admission_no: an, session: session, trip_code: tripCode, stop_key: sKey });
    }
  });
  return out;
}

/**
 * R30 job 1, planning half. parsed = parseStopImport result. existing = { stops, tripStops,
 * studentStops } as row objects from the sheet. Returns the rows to ADD and counts of what
 * already existed. Existing rows are never changed, so entered coordinates, verified_on and
 * assignments survive any number of runs. Imported stops have blank lat, lon, coord_source,
 * verified_by and verified_on, so the engine skips them until they are verified (R27).
 */
function gpsPlanStopImport_(parsed, existing, nowText, editor) {
  existing = existing || {};
  var idByKey = {}, maxN = 0;
  (existing.stops || []).forEach(function (s) {
    var id = gpsStr_(s.stop_id), k = gpsNormStopName_(s.stop_name);
    var m = /^S(\d+)$/.exec(id);
    if (m) maxN = Math.max(maxN, Number(m[1]));
    if (k && id && idByKey[k] === undefined) idByKey[k] = id;
  });
  var plan = { newStops: [], newTripStops: [], newStudentStops: [], unmapped: [],
    counts: { stops_new: 0, stops_existing: 0, trip_stops_new: 0, trip_stops_existing: 0,
              student_stops_new: 0, student_stops_existing: 0 } };

  (parsed.stops || []).forEach(function (s) {
    if (idByKey[s.key] !== undefined) { plan.counts.stops_existing++; return; }
    maxN++;
    var id = 'S' + ('00' + maxN).slice(-3);
    idByKey[s.key] = id;
    plan.newStops.push({ stop_id: id, stop_name: s.stop_name, landmark: s.landmark, lat: '', lon: '',
      radius_m: GPS_STOP_DEFAULT_RADIUS_M, kind: 'stop', coord_source: '', verified_by: '', verified_on: '',
      active: 'Yes', edited_by: editor, edited_at: nowText });
    plan.counts.stops_new++;
  });

  var haveTrip = {}, seqUsed = {};
  (existing.tripStops || []).forEach(function (t) {
    haveTrip[gpsStr_(t.trip_code) + '|' + gpsStr_(t.stop_id)] = true;
    var sq = gpsStr_(t.sequence);
    if (sq !== '') seqUsed[gpsStr_(t.trip_code) + '|' + sq] = gpsStr_(t.stop_id);
  });
  (parsed.tripStops || []).forEach(function (t) {
    var id = idByKey[t.stop_key];
    if (haveTrip[t.trip_code + '|' + id]) { plan.counts.trip_stops_existing++; return; }
    var sk = t.trip_code + '|' + t.sequence;
    if (seqUsed[sk] !== undefined && seqUsed[sk] !== id) {
      plan.unmapped.push({ row: 0, reason: 'Trip ' + t.trip_code + ' already has sequence ' + t.sequence + ' for another stop; ' + id + ' not added' });
      return;
    }
    haveTrip[t.trip_code + '|' + id] = true; seqUsed[sk] = id;
    plan.newTripStops.push({ trip_code: t.trip_code, sequence: t.sequence, stop_id: id, scheduled_time: t.scheduled_time });
    plan.counts.trip_stops_new++;
  });

  var haveStudent = {};
  (existing.studentStops || []).forEach(function (s) { haveStudent[gpsStr_(s.admission_no) + '|' + gpsStr_(s.session)] = true; });
  (parsed.studentStops || []).forEach(function (s) {
    var k = s.admission_no + '|' + s.session;
    if (haveStudent[k]) { plan.counts.student_stops_existing++; return; }
    haveStudent[k] = true;
    // notify starts as No: a manager turns a family on, nothing is switched on by an import.
    plan.newStudentStops.push({ admission_no: s.admission_no, session: s.session, trip_code: s.trip_code,
      stop_id: idByKey[s.stop_key], notify: 'No', active: 'Yes', gcm_reachable: '', edited_by: editor, edited_at: nowText });
    plan.counts.student_stops_new++;
  });
  return plan;
}

/** Round to 6 decimal places as a number. */
function gpsRound6_(n) { return Math.round(Number(n) * 1e6) / 1e6; }

/**
 * Check a coordinate pair. opts = { school: {lat, lon} | null, checkSchool: bool, maxKm }.
 * Rejects blanks, non-numbers, out-of-range values, 0,0, and (when checkSchool) anything
 * further than maxKm from the school, or any check when the school position is unknown.
 */
function gpsValidateCoord_(lat, lon, opts) {
  opts = opts || {};
  var blank = function (v) { return v === null || v === undefined || String(v).trim() === ''; };
  if (blank(lat) || blank(lon)) return { ok: false, error: 'No position was given.' };
  var la = Number(lat), lo = Number(lon);
  if (!isFinite(la) || !isFinite(lo)) return { ok: false, error: 'That position is not a number.' };
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return { ok: false, error: 'That position is outside the map.' };
  if (la === 0 && lo === 0) return { ok: false, error: 'That position (0, 0) is not a real place.' };
  if (opts.checkSchool) {
    var sc = opts.school;
    if (!sc || !isFinite(sc.lat) || !isFinite(sc.lon)) {
      return { ok: false, error: 'The school position is not set yet, so this spot cannot be checked. Set the school stop first.' };
    }
    var maxKm = opts.maxKm || GPS_MAX_STOP_KM;
    var km = gpsDistanceKm_(sc.lat, sc.lon, la, lo);
    if (km > maxKm) return { ok: false, error: 'That spot is ' + km.toFixed(1) + ' km from school. The limit is ' + maxKm + ' km.' };
  }
  return { ok: true, lat: gpsRound6_(la), lon: gpsRound6_(lo) };
}

/**
 * R30 job 2: is this bus's latest position good enough to save? bus is one entry of the
 * Worker's /v1/latest. Rejects an old fix (> maxAgeS) and an inaccurate or unreported
 * accuracy (> maxAccM): a coordinate saved from a bad fix would silently move a stop.
 */
function gpsEvaluateFix_(bus, nowMs, opts) {
  var maxAge = (opts && opts.maxAgeS) || GPS_MARK_MAX_AGE_S;
  var maxAcc = (opts && opts.maxAccuracyM) || GPS_MARK_MAX_ACCURACY_M;
  if (!bus) return { ok: false, error: 'That bus is not reporting a position.' };
  var fixTs = Number(bus.fix_ts);
  if (bus.fix_ts === null || bus.fix_ts === undefined || !isFinite(fixTs)) return { ok: false, error: 'That bus has not sent a position yet.' };
  var ageS = (nowMs - fixTs) / 1000;
  if (ageS < -30) return { ok: false, error: 'The bus position has a time in the future. Try again.' };
  if (ageS > maxAge) return { ok: false, error: 'The bus position is ' + Math.round(ageS) + ' seconds old (limit ' + maxAge + '). Wait for a new one and try again.' };
  var accRaw = bus.accuracy_m !== undefined ? bus.accuracy_m : bus.accuracy;
  var acc = (accRaw === null || accRaw === undefined || accRaw === '') ? NaN : Number(accRaw);
  if (!isFinite(acc)) return { ok: false, error: 'The bus did not report how accurate its position is, so it cannot be used.' };
  if (acc > maxAcc) return { ok: false, error: 'The bus position is only accurate to ' + Math.round(acc) + ' m (limit ' + maxAcc + ' m). Wait for a better fix.' };
  var c = gpsValidateCoord_(bus.lat, bus.lon, {});
  if (!c.ok) return { ok: false, error: 'That bus has no usable position. ' + c.error };
  return { ok: true, lat: c.lat, lon: c.lon, fix_ts: fixTs, accuracy_m: acc };
}

/**
 * Decide a save to one stop. stop = current Transport_Stops row. change = {lat, lon, source,
 * draft}. who = signed-in email. A verified stop (verified_on set) is replaced only with
 * overwrite = true, and never by a draft. A draft also needs overwrite to replace existing
 * coordinates. A draft leaves verified_by/verified_on blank so the engine still skips the stop.
 * Returns {ok, values, old, audit} or {ok:false, error, needs_overwrite}.
 */
function gpsPlanStopSave_(stop, change, who, today, nowText, overwrite) {
  var verified = gpsStr_(stop.verified_on) !== '';
  var hasCoords = gpsStr_(stop.lat) !== '' && gpsStr_(stop.lon) !== '';
  var old = { lat: gpsStr_(stop.lat), lon: gpsStr_(stop.lon), coord_source: gpsStr_(stop.coord_source),
              verified_by: gpsStr_(stop.verified_by), verified_on: gpsStr_(stop.verified_on) };
  if (verified && change.draft) {
    return { ok: false, error: 'This stop is already verified. A suggestion cannot replace it.' };
  }
  if ((verified || (change.draft && hasCoords)) && !overwrite) {
    return { ok: false, needs_overwrite: true,
      error: verified ? 'This stop is already verified (' + old.verified_on + ').' : 'This stop already has a draft position.' };
  }
  var values = { lat: change.lat, lon: change.lon, coord_source: change.source, edited_by: who, edited_at: nowText };
  if (!change.draft) { values.verified_by = who; values.verified_on = today; }
  var audit = (change.draft ? 'stop_draft:' : 'stop_save:') + gpsStr_(stop.stop_id) + ':' + change.source + ':' +
    change.lat + ',' + change.lon + (overwrite ? ':overwrite' : '') +
    (hasCoords || verified ? ':old=' + old.lat + ',' + old.lon + ',' + old.coord_source + ',' + old.verified_on : '');
  return { ok: true, values: values, old: old, audit: audit.slice(0, 250) };
}

/**
 * R30 job 4. points = [{t (ms), la, lo}] from the track. Walks the track in time order and
 * groups consecutive fixes that stay within radiusM of the first fix of the group (and with
 * no gap over maxGapSec). A group lasting at least minSec is a dwell. Dwells whose centroid is
 * within excludeRadiusM of any stop in opts.existingStops ([{lat, lon}]) are dropped.
 * Returns [{lat, lon, start_ts, end_ts, duration_s, count, time}] (6 d.p., time = HH:mm IST).
 * Boundaries are inclusive: exactly minSec and exactly radiusM both count.
 */
function suggestDwellStops(points, opts) {
  opts = opts || {};
  var minSec = opts.minSec !== undefined ? opts.minSec : GPS_DWELL_MIN_SEC;
  var radiusM = opts.radiusM !== undefined ? opts.radiusM : GPS_DWELL_RADIUS_M;
  var exclM = opts.excludeRadiusM !== undefined ? opts.excludeRadiusM : GPS_DWELL_RADIUS_M;
  var gapMs = (opts.maxGapSec !== undefined ? opts.maxGapSec : GPS_DWELL_MAX_GAP_S) * 1000;
  var EPS = 1e-6;
  var pts = (points || []).map(function (p) { return { t: Number(p.t), la: Number(p.la), lo: Number(p.lo), raw: p }; })
    .filter(function (p) { return isFinite(p.t) && isFinite(p.la) && isFinite(p.lo) && p.raw.la !== null && p.raw.lo !== null; })
    .sort(function (a, b) { return a.t - b.t; });
  var known = (opts.existingStops || []).map(function (s) { return { la: Number(s.lat), lo: Number(s.lon), raw: s }; })
    .filter(function (s) { return isFinite(s.la) && isFinite(s.lo) && gpsStr_(s.raw.lat) !== '' && gpsStr_(s.raw.lon) !== ''; });
  function metres(a, b) { return gpsDistanceKm_(a.la, a.lo, b.la, b.lo) * 1000; }

  var out = [], cluster = [];
  function flush() {
    if (cluster.length) {
      var first = cluster[0], last = cluster[cluster.length - 1];
      var dur = (last.t - first.t) / 1000;
      if (dur + EPS >= minSec) {
        var sla = 0, slo = 0;
        cluster.forEach(function (p) { sla += p.la; slo += p.lo; });
        var c = { la: sla / cluster.length, lo: slo / cluster.length };
        var near = known.some(function (s) { return metres(c, s) <= exclM + EPS; });
        if (!near) {
          out.push({ lat: gpsRound6_(c.la), lon: gpsRound6_(c.lo), start_ts: first.t, end_ts: last.t,
            duration_s: Math.round(dur), count: cluster.length, time: gpsFormatHm_(first.t) });
        }
      }
    }
    cluster = [];
  }
  pts.forEach(function (p) {
    if (!cluster.length) { cluster.push(p); return; }
    var prev = cluster[cluster.length - 1];
    if (p.t - prev.t > gapMs || metres(cluster[0], p) > radiusM + EPS) { flush(); cluster.push(p); }
    else cluster.push(p);
  });
  flush();
  return out;
}

/** The school's position from stop rows: first active kind=school row with usable coordinates, or null. */
function gpsSchoolFromStops_(stops) {
  var hit = (stops || []).filter(function (s) {
    return gpsStr_(s.kind) === 'school' && !gpsIsOff_(s.active) && gpsStr_(s.lat) !== '' && gpsStr_(s.lon) !== '' &&
      isFinite(Number(s.lat)) && isFinite(Number(s.lon));
  })[0];
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

// ---- 3. Apps Script glue ---------------------------------------------------

function gpsStopsRefusal_(auth) { return { ok: false, error: String(auth.error || 'You do not have access to this.') }; }

function gpsStopsDrop_() {
  try { CacheService.getScriptCache().remove(GPS_FLEET_CFG_KEY); } catch (e) { /* bookkeeping only */ }
}

/** Run fn under the script lock, or say the tool is busy. */
function gpsStopsLocked_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(GPS_STOP_LOCK_MS)) return { ok: false, error: 'Another save is running. Please try again in a moment.' };
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Append row objects to a tab in ONE setValues call, by header name. Returns rows added. */
function gpsAppendObjects_(sh, objs) {
  if (!objs.length) return 0;
  var width = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, width).getValues()[0];
  var rows = objs.map(function (o) { return gpsBuildLogRow_(headers, o); });
  var start = sh.getLastRow() + 1;
  var over = start + rows.length - 1 - sh.getMaxRows();
  if (over > 0) sh.insertRowsAfter(sh.getMaxRows(), over);
  sh.getRange(start, 1, rows.length, width).setValues(rows);
  return rows.length;
}

/** Read the settings tab as {key: value}. */
function gpsStopsSettings_(ss) {
  var m = {};
  try { gpsReadTab_(ss, GPS_SETTINGS_TAB).forEach(function (r) { var k = gpsStr_(r.setting); if (k) m[k] = gpsStr_(r.value); }); }
  catch (e) { /* no Settings tab: every setting is blank */ }
  return m;
}

/** List for the page: stops, bus ids, school position, whether the import is configured. */
function getGpsStops() {
  var auth = gpsRequire_('manage');
  if (!auth.ok) return gpsStopsRefusal_(auth);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stops, trips;
  try { stops = gpsReadTab_(ss, GPS_SHEETS.STOPS); trips = gpsReadTab_(ss, GPS_SHEETS.TRIPS); }
  catch (e) { return { ok: false, error: 'The GPS tabs are not set up yet.' }; }
  if (!gpsAudit_(auth.email, 'stops')) return { ok: false, error: 'Could not record this view. Please try again.' };
  var seen = {}, vehicles = [];
  trips.forEach(function (t) {
    var v = gpsStr_(t.vehicle_id);
    if (v && GPS_VEHICLE_ID_RE.test(v) && !gpsIsOff_(t.active) && !seen[v]) { seen[v] = true; vehicles.push(v); }
  });
  vehicles.sort();
  var settings = gpsStopsSettings_(ss);
  var list = stops.filter(function (s) { return gpsStr_(s.stop_id) && !gpsIsOff_(s.active); }).map(function (s) {
    var has = gpsStr_(s.lat) !== '' && gpsStr_(s.lon) !== '';
    return { stop_id: gpsStr_(s.stop_id), stop_name: gpsClampStr_(s.stop_name, GPS_IMPORT_TEXT_MAX),
      landmark: gpsClampStr_(s.landmark, GPS_IMPORT_TEXT_MAX), kind: gpsStr_(s.kind) || 'stop',
      lat: has ? Number(s.lat) : null, lon: has ? Number(s.lon) : null,
      coord_source: gpsStr_(s.coord_source), verified_on: gpsStr_(s.verified_on),
      unverified: gpsStr_(s.verified_on) === '' };
  });
  return { ok: true, as_of_text: gpsFormatHm_(Date.now()), stops: list, vehicles: vehicles,
    school: gpsSchoolFromStops_(stops), import_configured: GPS_SHEET_ID_RE.test(settings.stop_import_sheet_id || '') };
}

/**
 * Save coordinates to one stop, under the lock. The stop row is re-read inside the lock, the
 * audit row is written first, then the row is written back in one setValues call.
 * makePlan(stop, school) returns a gpsPlanStopSave_ result or a {ok:false} refusal.
 */
function gpsSaveStop_(email, stopId, makePlan) {
  if (!GPS_STOP_ID_RE.test(stopId)) return { ok: false, error: 'That stop is not valid.' };
  return gpsStopsLocked_(function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(GPS_SHEETS.STOPS);
    if (!sh || sh.getLastRow() < 1) return { ok: false, error: 'The GPS tabs are not set up yet.' };
    var cols = gpsHeaderMap_(sh);
    var need = ['stop_id', 'lat', 'lon', 'coord_source', 'verified_by', 'verified_on', 'edited_by', 'edited_at'];
    for (var i = 0; i < need.length; i++) {
      if (!cols[need[i]]) return { ok: false, error: 'Transport_Stops has no "' + need[i] + '" column. Run setup first.' };
    }
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    var values = sh.getRange(1, 1, lr, lc).getValues();
    var hits = [];
    for (var r = 1; r < values.length; r++) if (gpsStr_(values[r][cols.stop_id - 1]) === stopId) hits.push(r);
    if (!hits.length) return { ok: false, error: 'That stop is not on Transport_Stops.' };
    if (hits.length > 1) return { ok: false, error: 'Stop id ' + stopId + ' is on more than one row. Fix the sheet first.' };
    var row = values[hits[0]];
    var stop = {};
    Object.keys(cols).forEach(function (h) { stop[h] = gpsCellText_(row[cols[h] - 1]); });
    var plan = makePlan(stop, gpsSchoolFromStops_(gpsRowsToObjects_(values.map(function (rw) { return rw.map(gpsCellText_); }))));
    if (!plan.ok) return plan;
    if (!gpsLogAccess_(email, plan.audit)) return { ok: false, error: 'Could not record this save, so nothing was changed. Please try again.' };
    var out = row.slice();
    Object.keys(plan.values).forEach(function (h) { if (cols[h]) out[cols[h] - 1] = plan.values[h]; });
    sh.getRange(hits[0] + 1, 1, 1, lc).setValues([out]);
    gpsStopsDrop_();
    return { ok: true, stop_id: stopId, lat: plan.values.lat, lon: plan.values.lon, coord_source: plan.values.coord_source,
             verified: plan.values.verified_on !== undefined, verified_on: plan.values.verified_on || '' };
  });
}

function gpsStopsToday_() { return gpsServiceDate_(Date.now()); }
function gpsStopsNowText_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'); }

/**
 * R30 job 2. The position comes from the Worker's /v1/latest for the chosen vehicle, read
 * here on the server. The client sends only ids and the overwrite flag.
 */
function gpsMarkStop(stopId, vehicleId, overwrite) {
  var auth = gpsRequire_('manage');
  if (!auth.ok) return gpsStopsRefusal_(auth);
  var sid = gpsStr_(stopId), vid = gpsStr_(vehicleId);
  if (!GPS_STOP_ID_RE.test(sid)) return { ok: false, error: 'That stop is not valid.' };
  if (!GPS_VEHICLE_ID_RE.test(vid)) return { ok: false, error: 'Choose the bus first.' };
  var res = gpsWorkerCall_('read', 'GET', '/v1/latest', null);
  if (!res.ok) return { ok: false, error: 'Cannot reach the tracking service, so no position could be read. Try again.' };
  var bus = ((res.json && res.json.buses) || []).filter(function (b) { return gpsStr_(b.vehicle_id) === vid; })[0];
  var nowMs = Date.now();
  var fix = gpsEvaluateFix_(bus, nowMs, {});
  if (!fix.ok) return fix;
  var out = gpsSaveStop_(auth.email, sid, function (stop) {
    return gpsPlanStopSave_(stop, { lat: fix.lat, lon: fix.lon, source: 'driven', draft: false },
      auth.email, gpsStopsToday_(), gpsStopsNowText_(), overwrite === true);
  });
  if (out.ok) { out.position_as_of_text = gpsFormatHm_(fix.fix_ts); out.accuracy_m = Math.round(fix.accuracy_m); }
  return out;
}

/** R30 job 3. A tapped position, bounds-checked against the school. */
function gpsTapStop(stopId, lat, lon, overwrite) {
  var auth = gpsRequire_('manage');
  if (!auth.ok) return gpsStopsRefusal_(auth);
  var sid = gpsStr_(stopId);
  return gpsSaveStop_(auth.email, sid, function (stop, school) {
    var c = gpsValidateCoord_(lat, lon, { school: school, checkSchool: gpsStr_(stop.kind) !== 'school' });
    if (!c.ok) return c;
    return gpsPlanStopSave_(stop, { lat: c.lat, lon: c.lon, source: 'map_tap', draft: false },
      auth.email, gpsStopsToday_(), gpsStopsNowText_(), overwrite === true);
  });
}

/** Dwell suggestions for one bus and day. Read-only: nothing is written to Transport_Stops. */
function getGpsDwell(vehicleId, date) {
  var auth = gpsRequire_('manage');
  if (!auth.ok) return gpsStopsRefusal_(auth);
  var vid = gpsStr_(vehicleId), day = gpsStr_(date) || gpsServiceDate_(Date.now());
  if (!GPS_VEHICLE_ID_RE.test(vid) || !GPS_DATE_RE.test(day)) return { ok: false, error: 'That vehicle or date is not valid.' };
  var stops;
  try { stops = gpsReadTab_(SpreadsheetApp.getActiveSpreadsheet(), GPS_SHEETS.STOPS); }
  catch (e) { return { ok: false, error: 'The GPS tabs are not set up yet.' }; }
  if (!gpsAudit_(auth.email, 'dwell:' + vid + ':' + day)) return { ok: false, error: 'Could not record this view. Please try again.' };
  var r = gpsWorkerRead_('/v1/track', { vehicle_id: vid, date: day }, 'gps_trk_' + vid + '_' + day, function (b) {
    return { data_as_of: b.data_as_of === undefined ? null : b.data_as_of,
             points: (b.points || []).map(function (p) { return { t: p.fix_ts, la: p.lat, lo: p.lon }; }) };
  });
  var body = r.body || { points: [], data_as_of: null };
  var sug = suggestDwellStops(body.points || [], { existingStops: stops }).slice(0, GPS_DWELL_MAX_RESULTS);
  return { ok: true, down: r.down, vehicle_id: vid, date: day,
    data_as_of_text: body.data_as_of ? gpsFormatHm_(body.data_as_of) : '', suggestions: sug };
}

/**
 * Save a dwell suggestion as a DRAFT position for a chosen stop. The user's explicit choice
 * of source ('map_tap' or 'driven') is stored as coord_source, but verified_by/verified_on stay
 * blank, so the engine still skips the stop until someone verifies it with Mark or Map tap.
 */
function gpsSaveDwellDraft(stopId, lat, lon, source, overwrite) {
  var auth = gpsRequire_('manage');
  if (!auth.ok) return gpsStopsRefusal_(auth);
  var src = gpsStr_(source);
  if (src !== 'map_tap' && src !== 'driven') return { ok: false, error: 'Choose map tap or driven.' };
  return gpsSaveStop_(auth.email, gpsStr_(stopId), function (stop, school) {
    var c = gpsValidateCoord_(lat, lon, { school: school, checkSchool: gpsStr_(stop.kind) !== 'school' });
    if (!c.ok) return c;
    return gpsPlanStopSave_(stop, { lat: c.lat, lon: c.lon, source: src, draft: true },
      auth.email, gpsStopsToday_(), gpsStopsNowText_(), overwrite === true);
  });
}

/** The school's stop sheet as row objects keyed by its own headers. Throws a short message. */
function gpsReadImportSource_(settings) {
  var id = gpsStr_(settings.stop_import_sheet_id);
  if (!id) throw new Error('TODO(human): set stop_import_sheet_id in Settings to the school stop sheet.');
  if (!GPS_SHEET_ID_RE.test(id)) throw new Error('stop_import_sheet_id in Settings does not look like a Sheet ID.');
  var src;
  try { src = SpreadsheetApp.openById(id); } catch (e) { throw new Error('Could not open the school stop sheet. Check the ID and that this script may read it.'); }
  var tab = gpsStr_(settings.stop_import_sheet_tab);
  var sh = tab ? src.getSheetByName(tab) : src.getSheets()[0];
  if (!sh) throw new Error('The school stop sheet has no tab named "' + tab + '".');
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2 || lc < 1) return { headers: [], rows: [] };
  var values = sh.getRange(1, 1, lr, lc).getValues().map(function (row) { return row.map(gpsCellText_); });
  var headers = values[0].map(function (h) { return gpsStr_(h); }).filter(function (h) { return h; });
  return { headers: headers, rows: gpsRowsToObjects_(values) };
}

/** Read everything the planner needs and plan. Returns {parsed, plan} or throws a short message. */
function gpsStopsImportPlan_(ss, email) {
  var settings = gpsStopsSettings_(ss);
  var src = gpsReadImportSource_(settings);
  var mapRows = gpsReadTab_(ss, GPS_SHEETS.IMPORT_MAP);
  var trips = gpsReadTab_(ss, GPS_SHEETS.TRIPS);
  var parsed = parseStopImport(src.rows, mapRows, { headers: src.headers, trips: trips });
  var existing = { stops: gpsReadTab_(ss, GPS_SHEETS.STOPS), tripStops: gpsReadTab_(ss, GPS_SHEETS.TRIP_STOPS),
                   studentStops: gpsReadTab_(ss, GPS_SHEETS.STUDENT_STOPS) };
  var plan = gpsPlanStopImport_(parsed, existing, gpsStopsNowText_(), email);
  return { parsed: parsed, plan: plan };
}

function gpsImportSummary_(parsed, plan, applied) {
  var all = parsed.unmapped.concat(plan.unmapped);
  return { ok: true, dry_run: !applied, applied: !!applied, counts: plan.counts,
    missing_fields: parsed.missing, unmapped_total: all.length,
    unmapped: all.slice(0, GPS_IMPORT_REPORT_LIMIT) };
}

/**
 * R30 job 1. apply must be exactly true to write; anything else is a dry run that writes
 * nothing to the three stop tabs. Idempotent: existing rows are never changed.
 */
function gpsImportStops(apply) {
  var auth = gpsRequire_('manage');
  if (!auth.ok) return gpsStopsRefusal_(auth);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (apply !== true) {
    var d;
    try { d = gpsStopsImportPlan_(ss, auth.email); }
    catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
    if (!gpsAudit_(auth.email, 'stop_import_dry')) return { ok: false, error: 'Could not record this view. Please try again.' };
    return gpsImportSummary_(d.parsed, d.plan, false);
  }
  return gpsStopsLocked_(function () {
    var d;
    try { d = gpsStopsImportPlan_(ss, auth.email); }
    catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
    var c = d.plan.counts;
    if (!gpsLogAccess_(auth.email, 'stop_import:stops+' + c.stops_new + ',trip_stops+' + c.trip_stops_new +
        ',student_stops+' + c.student_stops_new + ',unmapped=' + (d.parsed.unmapped.length + d.plan.unmapped.length))) {
      return { ok: false, error: 'Could not record this import, so nothing was changed. Please try again.' };
    }
    var shs = ss.getSheetByName(GPS_SHEETS.STOPS), sht = ss.getSheetByName(GPS_SHEETS.TRIP_STOPS), shu = ss.getSheetByName(GPS_SHEETS.STUDENT_STOPS);
    gpsAppendObjects_(shs, d.plan.newStops);
    gpsAppendObjects_(sht, d.plan.newTripStops);
    gpsAppendObjects_(shu, d.plan.newStudentStops);
    gpsStopsDrop_();
    return gpsImportSummary_(d.parsed, d.plan, true);
  });
}
