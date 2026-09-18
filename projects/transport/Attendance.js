/**
 * Attendance.gs — daily driver attendance, and the monthly sheet it prints to.
 *
 * The coordinator's sheet is a month-wide grid, but that is the REPORT, not the
 * storage. Stored here as one row per person per day, which is what makes a
 * correction cheap, keeps an edit trail, and never needs a schema change when
 * someone joins or leaves.
 *
 * Who appears: every active driver in Driver_Master, plus any extra rows the
 * coordinator adds in Attendance_Roster (the Standby slots, and posts nobody is
 * named against yet). Extra rows live in their own tab so they never turn up in
 * the fuel or trip driver pickers.
 */

const ATTEND_CODES = ['P', 'L', 'H', 'O'];

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

/**
 * Everyone who should have a line on the sheet, in printing order.
 * A driver's route comes from the vehicle they are assigned to, so the two
 * documents agree without anyone maintaining a second list.
 */
function attendanceRoster_() {
  const routeOfVehicle = {};
  getRows_(SHEETS.VEHICLES).forEach(function (v) {
    routeOfVehicle[v.vehicle_id] = v.route_no || '';
  });

  const out = [];
  getRows_(SHEETS.DRIVERS).forEach(function (d) {
    if (isBlank_(d.driver_id) || String(d.status).toLowerCase() === 'retired') return;
    out.push({
      member_id: d.driver_id,
      name: d.name || '',
      route_no: routeOfVehicle[d.assigned_vehicle] || '',
      sort_order: toNum_(d.sort_order),
      kind: 'Driver'
    });
  });
  getRows_(SHEETS.ROSTER).forEach(function (r) {
    if (isBlank_(r.roster_id) || String(r.status).toLowerCase() === 'retired') return;
    out.push({
      member_id: r.roster_id,
      name: r.label || '',
      route_no: r.route_no || '',
      sort_order: toNum_(r.sort_order),
      kind: 'Extra'
    });
  });

  // Unordered rows sink to the bottom rather than jumping to the top.
  out.sort(function (a, b) {
    const sa = a.sort_order === null ? 1e9 : a.sort_order;
    const sb = b.sort_order === null ? 1e9 : b.sort_order;
    return sa - sb || String(a.route_no).localeCompare(String(b.route_no)) ||
           String(a.name).localeCompare(String(b.name));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Reading the log without dragging in every year of it
// ---------------------------------------------------------------------------

/**
 * Attendance rows for one month.
 * Reads the date column first and then only the block of rows that matched, so
 * printing August does not pull five years of history into memory.
 */
function attendanceRowsForRange_(from, to) {
  const sh = sheet_(SHEETS.ATTEND);
  const headers = HEADERS[SHEETS.ATTEND];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = readableCols_(sh, headers);
  const dIdx = headers.indexOf('date');
  if (dIdx < 0 || dIdx >= cols) return [];

  const dates = sh.getRange(2, dIdx + 1, last - 1, 1).getValues();
  const f = startOfDay_(from).getTime(), t = startOfDay_(to).getTime();
  var min = -1, max = -1;
  for (var i = 0; i < dates.length; i++) {
    const d = parseDate_(dates[i][0]);
    if (!d) continue;
    const ms = startOfDay_(d).getTime();
    if (ms >= f && ms <= t) { if (min < 0) min = i; max = i; }
  }
  if (min < 0) return [];

  // Back-dated corrections mean the matches are not guaranteed contiguous, so
  // read the whole span and filter precisely.
  const block = sh.getRange(2 + min, 1, max - min + 1, cols).getValues();
  const out = [];
  block.forEach(function (row) {
    const o = {};
    headers.forEach(function (h, c) { o[h] = (c < cols) ? row[c] : ''; });
    const d = parseDate_(o.date);
    if (!d) return;
    const ms = startOfDay_(d).getTime();
    if (ms >= f && ms <= t) out.push(o);
  });
  return out;
}

function dayKey_(date, memberId) {
  return Utilities.formatDate(startOfDay_(date), TZ_(), 'yyyy-MM-dd') + '|' + memberId;
}

/** The weekday the school does not run, e.g. Sunday. Blank means none. */
function weekOffDay_() {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const want = String(getSetting_('attendance_week_off', 'Sunday')).trim().toLowerCase();
  const i = names.indexOf(want);
  return i < 0 ? -1 : i;
}

function isWeekOff_(date) {
  const off = weekOffDay_();
  return off >= 0 && date.getDay() === off;
}

// ---------------------------------------------------------------------------
// Marking a day
// ---------------------------------------------------------------------------

/**
 * The roster for one day, with whatever has already been marked.
 * Nothing marked yet? Everyone comes back as P — the coordinator's sheet runs
 * about 97% present, so the job becomes "change the two who are out" rather
 * than "tap thirty-five people". Nothing is stored until they save.
 */
function getAttendanceDay(token, dateStr) {
  if (!adminName_(token)) return needAdmin_();
  try {
    const date = parseDate_(dateStr);
    if (!date) return fail_('Pick a date.');
    const roster = attendanceRoster_();
    const existing = {};
    attendanceRowsForRange_(date, date).forEach(function (r) {
      existing[String(r.member_id).trim()] = r;
    });
    const marked = Object.keys(existing).length > 0;

    return {
      ok: true,
      date: Utilities.formatDate(startOfDay_(date), TZ_(), 'yyyy-MM-dd'),
      dateLabel: Utilities.formatDate(date, TZ_(), 'EEEE, d MMMM yyyy'),
      weekOff: isWeekOff_(date),
      alreadyMarked: marked,
      codes: ATTEND_CODES,
      labels: ATTENDANCE_LABELS,
      rows: roster.map(function (m, i) {
        const hit = existing[m.member_id];
        const code = hit ? String(hit.code || '').trim().toUpperCase() : '';
        return {
          sno: i + 1,
          member_id: m.member_id,
          name: m.name,
          route_no: m.route_no,
          kind: m.kind,
          // Unmarked day → suggest P. Marked day → show exactly what is stored,
          // including a deliberate blank.
          code: marked ? code : 'P',
          note: hit ? (hit.note || '') : '',
          stored: !!hit
        };
      })
    };
  } catch (e) { return fail_(e.message); }
}

/**
 * Write a whole day in one go.
 * Upserted on (date, member) so re-marking a day is a correction, never a
 * duplicate — which also makes a double-tapped Save harmless.
 */
function markAttendanceDay(token, dateStr, marks) {
  const who = adminName_(token); if (!who) return needAdmin_();
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(20000)) return fail_('Someone else is saving attendance. Try again in a moment.');
    const date = parseDate_(dateStr);
    if (!date) return fail_('Pick a date.');
    if (startOfDay_(date) > startOfDay_(new Date())) return fail_('That date is in the future.');
    if (!marks || !marks.length) return fail_('Nothing to save.');

    const day = startOfDay_(date);
    const roster = {};
    attendanceRoster_().forEach(function (m) { roster[m.member_id] = m; });

    // Validate everything before writing anything.
    const clean = [];
    for (var i = 0; i < marks.length; i++) {
      const m = marks[i];
      const id = String(m.member_id || '').trim();
      if (!id) continue;
      if (!roster[id]) return fail_('"' + id + '" is not on the roster any more — reload and try again.');
      const code = String(m.code || '').trim().toUpperCase();
      if (code !== '' && ATTEND_CODES.indexOf(code) < 0) return fail_('Unknown attendance code "' + code + '".');
      clean.push({ id: id, code: code, note: String(m.note || '').trim(), member: roster[id] });
    }
    if (!clean.length) return fail_('Nothing to save.');

    // Find which of these already have a row for the day.
    const sh = sheet_(SHEETS.ATTEND);
    const headers = HEADERS[SHEETS.ATTEND];
    const cols = readableCols_(sh, headers);
    const kIdx = headers.indexOf('day_key');
    if (kIdx < 0 || kIdx >= cols) return fail_('The attendance tab is not built yet. Run Fleet → Set up workbook.');
    const last = sh.getLastRow();
    const rowOf = {};
    if (last >= 2) {
      const keys = sh.getRange(2, kIdx + 1, last - 1, 1).getValues();
      for (var j = 0; j < keys.length; j++) {
        const k = String(keys[j][0]).trim();
        if (k) rowOf[k] = j + 2; // sheet row number
      }
    }

    const now = new Date();
    const updates = [], inserts = [];
    clean.forEach(function (c) {
      const key = dayKey_(day, c.id);
      const rec = {
        timestamp: now, date: day, day_key: key, member_id: c.id,
        name: c.member.name, route_no: c.member.route_no,
        code: c.code, note: c.note, entered_by: who, edited_by: '', edited_at: ''
      };
      if (rowOf[key]) {
        rec.edited_by = who; rec.edited_at = now;
        updates.push({ row: rowOf[key], rec: rec });
      } else {
        inserts.push(rec);
      }
    });

    // Existing rows are not necessarily contiguous — a back-dated correction can
    // land anywhere — so write each one on its own rather than assuming a block.
    updates.forEach(function (u) {
      const values = headers.slice(0, cols).map(function (h) {
        return (u.rec[h] === undefined || u.rec[h] === null) ? '' : u.rec[h];
      });
      sh.getRange(u.row, 1, 1, cols).setValues([values]);
    });
    if (inserts.length) appendRows_(SHEETS.ATTEND, inserts);
    delete ROWS_MEMO_[SHEETS.ATTEND];

    const present = clean.filter(function (c) { return c.code === 'P'; }).length;
    const away = clean.filter(function (c) { return c.code && c.code !== 'P'; }).length;
    return ok_('Attendance saved for ' + Utilities.formatDate(day, TZ_(), 'd MMM yyyy') +
               ' — ' + present + ' present' + (away ? ', ' + away + ' not' : '') + '.');
  } catch (e) {
    return fail_(e.message);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// The monthly grid
// ---------------------------------------------------------------------------

/** month is 'yyyy-MM'. Returns the grid the sheet and the exports are built from. */
function attendanceGrid_(month) {
  const p = String(month).split('-');
  const y = parseInt(p[0], 10), mo = parseInt(p[1], 10);
  if (!y || !mo || mo < 1 || mo > 12) throw new Error('Pick a month.');
  const first = new Date(y, mo - 1, 1);
  const days = new Date(y, mo, 0).getDate();
  const last = new Date(y, mo - 1, days);

  const roster = attendanceRoster_();
  const stored = attendanceRowsForRange_(first, last);

  // Anyone who has marks this month but has since left still gets their line,
  // so a reprint matches the copy that was filed at the time.
  const known = {};
  roster.forEach(function (m) { known[m.member_id] = m; });
  stored.forEach(function (r) {
    const id = String(r.member_id || '').trim();
    if (id && !known[id]) {
      known[id] = { member_id: id, name: r.name || id, route_no: r.route_no || '',
                    sort_order: 1e9, kind: 'Left' };
      roster.push(known[id]);
    }
  });

  const byMember = {};
  stored.forEach(function (r) {
    const id = String(r.member_id || '').trim();
    const d = parseDate_(r.date);
    if (!id || !d) return;
    (byMember[id] = byMember[id] || {})[d.getDate()] = String(r.code || '').trim().toUpperCase();
  });

  const dayInfo = [];
  for (var dnum = 1; dnum <= days; dnum++) {
    const dt = new Date(y, mo - 1, dnum);
    dayInfo.push({
      day: dnum,
      dow: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dt.getDay()],
      weekOff: isWeekOff_(dt)
    });
  }

  const rows = roster.map(function (m, i) {
    const marks = byMember[m.member_id] || {};
    const cells = dayInfo.map(function (di) {
      if (di.weekOff) return '';                    // the school does not run
      return marks[di.day] || '';                   // no row, or cleared, prints blank
    });
    return {
      sno: i + 1, member_id: m.member_id, name: m.name, route_no: m.route_no, kind: m.kind,
      cells: cells,
      present: cells.filter(function (c) { return c === 'P'; }).length,
      half: cells.filter(function (c) { return c === 'H'; }).length,
      leave: cells.filter(function (c) { return c === 'L'; }).length,
      markedDays: cells.filter(function (c) { return c !== ''; }).length
    };
  });

  // Per-day tallies, computed rather than transcribed — the office's own sheet
  // counts a phantom 35th row because those totals were typed by hand.
  const tallies = dayInfo.map(function (di, idx) {
    var p = 0, l = 0, h = 0, o = 0;
    rows.forEach(function (r) {
      const c = r.cells[idx];
      if (c === 'P') p++; else if (c === 'L') l++; else if (c === 'H') h++; else if (c === 'O') o++;
    });
    return { present: p, leave: l, half: h, holiday: o, total: p + l + h + o };
  });

  // A working day is one somebody actually marked; a day the office forgot is
  // not silently counted as a day nobody worked.
  const workingDays = dayInfo.filter(function (di, idx) {
    return !di.weekOff && tallies[idx].total > 0;
  }).length;

  return {
    month: month,
    monthLabel: Utilities.formatDate(first, TZ_(), 'MMM yyyy'),
    days: dayInfo, rows: rows, tallies: tallies, workingDays: workingDays,
    labels: ATTENDANCE_LABELS
  };
}

function getAttendanceMonth(token, month) {
  if (!adminName_(token)) return needAdmin_();
  try {
    const g = attendanceGrid_(month);
    g.ok = true;
    return g;
  } catch (e) { return fail_(e.message); }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

function csvCell_(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** The month as CSV, laid out like the sheet the office keeps today. */
function attendanceCsv_(g) {
  const width = 3 + g.days.length + 3;
  const pad = function (arr) {
    const a = arr.slice();
    while (a.length < width) a.push('');
    return a.map(csvCell_).join(',');
  };
  const lines = [];
  lines.push(pad([g.monthLabel]));
  lines.push(pad(['', '', ''].concat(g.days.map(function (d) { return d.day; }))
    .concat(['Total Days', 'Days Present', 'Working Days'])));
  lines.push(pad(['S.No', 'Route', 'Driver Name'].concat(g.days.map(function (d) {
    return d.weekOff ? 'SUNDAY' : d.dow;
  }))));
  g.rows.forEach(function (r) {
    lines.push(pad([r.sno, r.route_no, r.name].concat(r.cells)
      .concat([r.markedDays, r.present + (r.half ? r.half * 0.5 : 0), g.workingDays])));
  });
  lines.push(pad(['', 'Total', 'Present'].concat(g.tallies.map(function (t) { return t.present; }))));
  lines.push(pad(['', '', 'Leave'].concat(g.tallies.map(function (t) { return t.leave; }))));
  lines.push(pad(['', '', 'Half day'].concat(g.tallies.map(function (t) { return t.half; }))));
  lines.push(pad(['', '', 'Total'].concat(g.tallies.map(function (t) { return t.total; }))));
  lines.push(pad([]));
  ATTEND_CODES.forEach(function (c) { lines.push(pad(['', ATTENDANCE_LABELS[c], c])); });
  return lines.join('\n');
}

function exportAttendanceCsv(token, month) {
  if (!adminName_(token)) return needAdmin_();
  try {
    const g = attendanceGrid_(month);
    const csv = attendanceCsv_(g);
    return {
      ok: true,
      filename: 'Attendance ' + g.monthLabel + '.csv',
      b64: Utilities.base64Encode(Utilities.newBlob(csv, 'text/csv').getBytes()),
      message: 'CSV ready — ' + g.rows.length + ' people, ' + g.workingDays + ' working days.'
    };
  } catch (e) { return fail_(e.message); }
}

/** The month as a landscape PDF, and a copy filed in Drive. */
function generateAttendancePdf(token, month) {
  const who = adminName_(token); if (!who) return needAdmin_();
  const lock = LockService.getScriptLock();
  var doc = null;
  try {
    if (!lock.tryLock(30000)) return fail_('Another report is being generated. Try again in a moment.');
    const g = attendanceGrid_(month);
    if (!g.rows.length) return fail_('Nobody on the roster yet — add drivers first.');
    const s = getSettings();
    const name = 'Driver Attendance ' + g.monthLabel;

    doc = DocumentApp.create(name);
    const body = doc.getBody();
    body.setPageWidth(792).setPageHeight(612);
    body.setMarginTop(24).setMarginBottom(24).setMarginLeft(20).setMarginRight(20);
    const seed = body.getChild(0);

    body.appendParagraph(s.school_name || 'Fleet')
        .setHeading(DocumentApp.ParagraphHeading.HEADING1)
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setForegroundColor('#1e3a5f');
    body.appendParagraph('Driver Attendance — ' + g.monthLabel)
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setForegroundColor('#555555');

    const head1 = ['S.No', 'Route', 'Driver Name'].concat(g.days.map(function (d) { return String(d.day); }))
      .concat(['Present', 'Leave']);
    const head2 = ['', '', ''].concat(g.days.map(function (d) { return d.weekOff ? '–' : d.dow; }))
      .concat(['', '']);
    const data = [head1, head2].concat(g.rows.map(function (r) {
      return [String(r.sno), r.route_no, r.name].concat(r.cells)
        .concat([String(r.present + (r.half ? r.half * 0.5 : 0)), String(r.leave)]);
    }));
    data.push(['', '', 'Present'].concat(g.tallies.map(function (t) { return String(t.present); })).concat(['', '']));
    data.push(['', '', 'Leave'].concat(g.tallies.map(function (t) { return String(t.leave); })).concat(['', '']));

    const table = body.appendTable(data);
    table.setBorderWidth(0.5);
    const nDays = g.days.length;
    for (var r = 0; r < table.getNumRows(); r++) {
      const row = table.getRow(r);
      for (var c = 0; c < row.getNumCells(); c++) {
        const cell = row.getCell(c);
        cell.setPaddingTop(1).setPaddingBottom(1).setPaddingLeft(1).setPaddingRight(1);
        if (c === 0) cell.setWidth(26);
        else if (c === 1) cell.setWidth(58);
        else if (c === 2) cell.setWidth(110);
        else if (c < 3 + nDays) cell.setWidth(15);
        else cell.setWidth(30);
        const headerRow = r <= 1;
        if (headerRow) cell.setBackgroundColor('#1e9ae0');
        else if (r >= table.getNumRows() - 2) cell.setBackgroundColor('#E8E1F5');
        styleCell_(cell, headerRow, DocumentApp.HorizontalAlignment.CENTER,
                   headerRow ? '#FFFFFF' : '#000000', 6);
      }
    }

    body.appendParagraph('').setSpacingBefore(8);
    body.appendParagraph(ATTEND_CODES.map(function (c) {
      return c + ' = ' + ATTENDANCE_LABELS[c];
    }).join('    ·    ') + '        Working days: ' + g.workingDays)
      .setForegroundColor('#555555');
    appendSignatures_(body, s);
    body.removeChild(seed);
    doc.saveAndClose();

    const file = DriveApp.getFileById(doc.getId());
    const pdf = file.getAs('application/pdf').setName(name + '.pdf');
    const it = DriveApp.getFoldersByName('Fleet Attendance');
    const folder = it.hasNext() ? it.next() : DriveApp.createFolder('Fleet Attendance');
    const saved = folder.createFile(pdf);
    file.setTrashed(true);

    return {
      ok: true,
      message: 'Attendance sheet ready — ' + g.rows.length + ' people, ' +
               g.workingDays + ' working days. A copy is filed in Drive.',
      filename: name + '.pdf',
      driveUrl: saved.getUrl(),
      b64: Utilities.base64Encode(pdf.getBytes())
    };
  } catch (e) {
    if (doc) { try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (e2) {} }
    return fail_(e.message);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// The extra roster rows (Standby, unnamed posts)
// ---------------------------------------------------------------------------

function listRoster(token) {
  if (!adminName_(token)) return needAdmin_();
  return {
    ok: true,
    extras: getRows_(SHEETS.ROSTER).filter(function (r) { return !isBlank_(r.roster_id); }).map(rowForClient_),
    roster: attendanceRoster_()
  };
}

function addRosterRow(token, d) {
  const who = adminName_(token); if (!who) return needAdmin_();
  try {
    if (isBlank_(d.label)) return fail_('Give the row a name, e.g. "Standby".');
    const id = nextId_(SHEETS.ROSTER, 'roster_id', 'X');
    appendRow_(SHEETS.ROSTER, {
      roster_id: id, label: d.label, route_no: d.route_no || '',
      sort_order: toNum_(d.sort_order), status: 'Active',
      edited_by: who, edited_at: new Date()
    });
    return ok_('Added "' + d.label + '" to the attendance sheet.');
  } catch (e) { return fail_(e.message); }
}

function updateRosterRow(token, id, d) {
  const who = adminName_(token); if (!who) return needAdmin_();
  try {
    if (isBlank_(d.label)) return fail_('Give the row a name.');
    const ok = updateRowById_(SHEETS.ROSTER, 'roster_id', id, {
      label: d.label, route_no: d.route_no || '', sort_order: toNum_(d.sort_order),
      status: d.status || 'Active', edited_by: who, edited_at: new Date()
    });
    return ok ? ok_('Row updated.') : fail_('Could not find that row.');
  } catch (e) { return fail_(e.message); }
}

function retireRosterRow(token, id) {
  const who = adminName_(token); if (!who) return needAdmin_();
  const ok = updateRowById_(SHEETS.ROSTER, 'roster_id', id, {
    status: 'Retired', edited_by: who, edited_at: new Date()
  });
  return ok ? ok_('Row removed from the sheet (past months keep it).') : fail_('Could not find that row.');
}
