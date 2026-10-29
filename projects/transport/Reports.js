/**
 * Reports.gs — everything that arrives by itself: the morning check email,
 * the Monday digest, the monthly report, and the nightly backup.
 *
 * All of these run from time triggers (see Triggers.gs) and can also be run
 * by hand from the 🚌 Fleet menu.
 */

// ---------------------------------------------------------------------------
// Morning checks — one email listing everything that needs a human
// ---------------------------------------------------------------------------

function morningChecks() {
  const settings = getSettings();
  const sym = settings.currency_symbol || '₹';
  const vehicles = getRows_(SHEETS.VEHICLES);
  const regOf = {};
  vehicles.forEach(function (v) { regOf[v.vehicle_id] = v.reg_no || v.vehicle_id; });
  const active = vehicles.filter(function (v) { return String(v.status).toLowerCase() === 'active'; });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const recentCutoff = new Date(today.getTime() - 3 * 86400000); // "new" = last 3 days

  const sections = [];

  // 1) Vehicle documents expiring (same check the dashboard shows).
  const docs = upcomingExpiries_(regOf, settings);
  if (docs.length) {
    sections.push(sec_('📄 Documents expiring', ['Vehicle', 'Document', 'Expires', 'Status'],
      docs.map(function (e) {
        return [e.reg_no, e.doc_type + (e.number ? ' (' + e.number + ')' : ''), e.expiry,
                e.daysLeft < 0 ? 'EXPIRED' : e.daysLeft + ' days left'];
      })));
  }

  // 2) Driver licences expiring.
  const licDays = parseInt(settings.licence_warning_days, 10) || 30;
  const lic = [];
  getRows_(SHEETS.DRIVERS).forEach(function (d) {
    if (String(d.status).toLowerCase() === 'retired') return;
    const exp = parseDate_(d.licence_expiry);
    if (!exp) return;
    const days = Math.round((exp - today) / 86400000);
    if (days <= licDays) lic.push({ days: days, row: [d.name, Utilities.formatDate(exp, TZ_(), 'dd MMM yyyy'), days < 0 ? 'EXPIRED' : days + ' days left'] });
  });
  if (lic.length) {
    lic.sort(function (a, b) { return a.days - b.days; });
    sections.push(sec_('🪪 Driver licences expiring', ['Driver', 'Expires', 'Status'],
      lic.map(function (x) { return x.row; })));
  }

  // 3) Service due (fleet-wide service date — RFC-0002).
  const service = computeServiceDue_(active, regOf, settings);
  if (service.noDateSet) {
    sections.push(sec_('🔧 Service due', ['Status'], [['No service due date is set — see Settings.']]));
  } else {
    const serviceRows = service.due.slice();
    if (service.unknownCount) {
      serviceRows.push([service.unknownCount + ' vehicle(s) with no maintenance history', 'Unknown']);
    }
    if (serviceRows.length) sections.push(sec_('🔧 Service due', ['Vehicle', 'Status'], serviceRows));
  }

  // 4) Silent vehicles (active, but no fuel entry for a while).
  //    Off-road vehicles are meant to be silent, so they never appear here.
  const silent = computeSilentVehicles_(active, regOf, settings, today);
  if (silent.length) sections.push(sec_('🔇 No recent entries', ['Vehicle', 'Last fuel entry'], silent));

  // 4b) Off road too long, and odometers left out of action too long. Both are
  //     usually someone forgetting to flip the flag back, and both quietly cost
  //     you data — an off-road bus is excluded from most checks, and a dead
  //     meter means no cost/km for that vehicle at all.
  const state = fleetStateLists_();
  const offDays = parseInt(settings.off_road_reminder_days, 10) || 7;
  const staleOff = state.offRoad.filter(function (o) { return o.days !== null && o.days >= offDays; });
  if (staleOff.length) {
    sections.push(sec_('🔧 Off road for a while', ['Vehicle', 'Since', 'Days'],
      staleOff.map(function (o) { return [o.reg_no, o.since, o.days]; })));
  }
  // 4c) Attendance not marked yesterday. Cheap to check, and a day missed is a
  //     day that silently drops out of the month's totals.
  if (yes_(settings.attendance_reminder || 'Yes')) {
    const yday = new Date(today.getTime() - 86400000);
    if (!isWeekOff_(yday)) {
      const marked = attendanceRowsForRange_(yday, yday).length;
      if (!marked) {
        sections.push(sec_('🗓 Attendance not marked', ['Day', 'Status'],
          [[Utilities.formatDate(yday, TZ_(), 'EEEE d MMM'), 'nobody marked yet']]));
      }
    }
  }

  const odoDays = parseInt(settings.odo_broken_reminder_days, 10) || 14;
  const staleOdo = state.odoDown.filter(function (o) { return o.days === null || o.days >= odoDays; });
  if (staleOdo.length) {
    sections.push(sec_('🚫 Odometer still not working', ['Vehicle', 'Since', 'Days without a reading'],
      staleOdo.map(function (o) { return [o.reg_no, o.since, o.days === null ? '—' : o.days]; })));
  }

  // 5) Suspicious odometer jumps in the last few days (likely typos).
  const jumpKm = parseFloat(settings.odo_jump_km) || 3000;
  const jumps = [];
  active.forEach(function (v) {
    const pts = collectOdoPoints_(v.vehicle_id);
    for (var i = 1; i < pts.length; i++) {
      const gap = pts[i].odo - pts[i - 1].odo;
      if (pts[i].date >= recentCutoff && gap > jumpKm) {
        jumps.push([regOf[v.vehicle_id],
          pts[i - 1].odo.toLocaleString() + ' → ' + pts[i].odo.toLocaleString(),
          '+' + Math.round(gap).toLocaleString() + ' km']);
      }
    }
  });
  if (jumps.length) sections.push(sec_('❓ Odometer jumps (check for typos)', ['Vehicle', 'Readings', 'Jump'], jumps));

  // 6) Fuel entries whose price per litre looks wrong.
  const price = parseFloat(settings.fuel_price_per_litre);
  const tolPct = parseFloat(settings.fuel_price_tolerance_pct) || 25;
  if (!isNaN(price) && price > 0) {
    const odd = [];
    getRows_(SHEETS.FUEL).forEach(function (r) {
      if (isVoided_(r)) return;
      const d = parseDate_(r.date), L = toNum_(r.litres), amt = toNum_(r.amount);
      if (!d || d < recentCutoff || !L || L <= 0 || amt === null) return;
      const per = amt / L;
      if (Math.abs(per - price) / price * 100 > tolPct) {
        odd.push([regOf[r.vehicle_id] || r.vehicle_id, Utilities.formatDate(d, TZ_(), 'dd MMM'),
                  sym + per.toFixed(2) + '/L (expected ~' + sym + price + ')']);
      }
    });
    if (odd.length) sections.push(sec_('⛽ Fuel price looks off', ['Vehicle', 'Date', 'Worked out as'], odd));
  }

  if (!sections.length) {
    try { SpreadsheetApp.getActive().toast('Morning checks: all clear.', 'Fleet', 4); } catch (e) {}
    return;
  }
  sendFleetEmail_('Fleet: ' + sections.length + ' thing(s) need attention',
    'Morning check', sections.join(''));
  try { SpreadsheetApp.getActive().toast('Morning checks: emailed ' + sections.length + ' section(s).', 'Fleet', 4); } catch (e) {}
}

/** Old name kept so any existing trigger or habit still works. */
// (checkDocumentExpiry in Triggers.gs calls morningChecks)

/**
 * date minus N months, clamped to the last valid day of the target month
 * (Date.setMonth overflows instead, e.g. Mar 31 - 1mo would land in April).
 */
function subtractMonthsClamped_(date, months) {
  const totalMonths = date.getFullYear() * 12 + date.getMonth() - months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(date.getDate(), daysInTargetMonth));
}

/**
 * Fleet-wide, date-based service check (RFC-0002).
 *
 * Returns { noDateSet, due, unknownCount }:
 *   noDateSet    — true when Settings has no service_due_date at all; callers
 *                  must say so rather than silently listing nothing, since a
 *                  blank due list must not read the same as "all fine".
 *   due          — [reg_no, ...] for vehicles due (only meaningful when
 *                  noDateSet is false).
 *   unknownCount — active vehicles with no maintenance record at all. Never
 *                  counted as due (a fleet-wide date must not flag a vehicle
 *                  with no history the moment the date passes).
 */
function computeServiceDue_(active, regOf, settings) {
  const dueDate = parseDate_(settings.service_due_date);
  if (!dueDate) return { noDateSet: true, due: [], unknownCount: 0 };

  const parsedMonths = parseInt(settings.service_interval_months, 10);
  const months = isNaN(parsedMonths) ? 12 : parsedMonths;
  const dueDateStart = startOfDay_(dueDate);
  const isPastDue = startOfDay_(new Date()) >= dueDateStart;
  const cutoff = subtractMonthsClamped_(dueDateStart, months);

  const maint = getRows_(SHEETS.MAINT).filter(function (r) { return !isVoided_(r); });
  const hasAnyRecord = {};
  const servicedSinceCutoff = {};
  maint.forEach(function (r) {
    hasAnyRecord[r.vehicle_id] = true;
    if (String(r.category).toLowerCase() !== 'scheduled') return;
    const d = parseDate_(r.date);
    if (d && startOfDay_(d) >= cutoff) servicedSinceCutoff[r.vehicle_id] = true;
  });

  const due = [];
  var unknownCount = 0;
  active.forEach(function (v) {
    if (!hasAnyRecord[v.vehicle_id]) { unknownCount++; return; }
    if (isPastDue && !servicedSinceCutoff[v.vehicle_id]) due.push([regOf[v.vehicle_id], 'Service due']);
  });
  return { noDateSet: false, due: due, unknownCount: unknownCount };
}

function computeSilentVehicles_(active, regOf, settings, today) {
  const silentDays = parseInt(settings.silent_vehicle_days, 10) || 21;
  const fuel = getRows_(SHEETS.FUEL).filter(function (r) { return !isVoided_(r); });
  const out = [];
  active.forEach(function (v) {
    var lastD = null;
    fuel.forEach(function (r) {
      if (r.vehicle_id !== v.vehicle_id) return;
      const d = parseDate_(r.date);
      if (d && (!lastD || d > lastD)) lastD = d;
    });
    if (!lastD) { out.push([regOf[v.vehicle_id], 'never — no fuel entries yet']); return; }
    const days = Math.floor((today - lastD) / 86400000);
    if (days >= silentDays) out.push([regOf[v.vehicle_id], days + ' days ago']);
  });
  return out;
}

/**
 * Every odometer reading we have for one vehicle, oldest first.
 * Readings from a meter that has since been replaced are left out — they are
 * not comparable with the current one.
 */
function collectOdoPoints_(vehicleId) {
  const ctx = odoContext_(vehicleId);
  const pts = [];
  function add(d, o) {
    const dd = parseDate_(d), n = toNum_(o);
    if (!dd || n === null) return;
    if (ctx.eraFrom && startOfDay_(dd) < ctx.eraFrom) return;
    pts.push({ date: dd, odo: n });
  }
  getRows_(SHEETS.FUEL).forEach(function (r) { if (r.vehicle_id === vehicleId && !isVoided_(r)) add(r.date, r.odometer); });
  getRows_(SHEETS.MAINT).forEach(function (r) { if (r.vehicle_id === vehicleId && !isVoided_(r)) add(r.date, r.odometer); });
  getRows_(SHEETS.TRIP).forEach(function (r) {
    if (r.vehicle_id === vehicleId && !isVoided_(r)) { add(r.date, r.open_odo); add(r.date, r.close_odo); }
  });
  pts.sort(function (a, b) { return a.date - b.date || a.odo - b.odo; });
  return pts;
}

// ---------------------------------------------------------------------------
// Weekly digest — Monday morning summary of the last 7 days
// ---------------------------------------------------------------------------

function weeklyDigest() {
  const settings = getSettings();
  if (String(settings.weekly_digest || 'Yes').toLowerCase().indexOf('n') === 0) return;
  const sym = settings.currency_symbol || '₹';
  const cutoff = new Date(Date.now() - 7 * 86400000);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const vehicles = getRows_(SHEETS.VEHICLES);
  const regOf = {};
  vehicles.forEach(function (v) { regOf[v.vehicle_id] = v.reg_no || v.vehicle_id; });
  const active = vehicles.filter(function (v) { return String(v.status).toLowerCase() === 'active'; });
  // The digest table also covers off-road buses — the week a bus is in the
  // garage is exactly the week its maintenance spend matters.
  const onBooks = vehicles.filter(function (v) {
    return !isBlank_(v.vehicle_id) && String(v.status).toLowerCase() !== 'retired' &&
           (String(v.status).toLowerCase() === 'active' || isOffRoad_(v));
  });

  const fuel = getRows_(SHEETS.FUEL).filter(function (r) { return !isVoided_(r); });
  const maint = getRows_(SHEETS.MAINT).filter(function (r) { return !isVoided_(r); });

  // Per-vehicle 7-day table (km is approximate: readings inside the window).
  var tKm = 0, tFuel = 0, tMaint = 0;
  const rows = onBooks.map(function (v) {
    const measurable = odoWorks_(v);
    const pts = collectOdoPoints_(v.vehicle_id).filter(function (p) { return p.date >= cutoff; });
    const km = (measurable && pts.length >= 2) ? pts[pts.length - 1].odo - pts[0].odo : 0;
    var fSpend = 0, mSpend = 0, downtime = 0;
    fuel.forEach(function (r) {
      const d = parseDate_(r.date);
      if (r.vehicle_id === v.vehicle_id && d && d >= cutoff) fSpend += toNum_(r.amount) || 0;
    });
    maint.forEach(function (r) {
      const d = parseDate_(r.date);
      if (r.vehicle_id === v.vehicle_id && d && d >= cutoff) {
        mSpend += (toNum_(r.parts) || 0) + (toNum_(r.labour) || 0);
        downtime += toNum_(r.downtime_days) || 0;
      }
    });
    tKm += km; tFuel += fSpend; tMaint += mSpend;
    const tag = (isOffRoad_(v) ? ' 🔧 off road' : '') + (measurable ? '' : ' 🚫 no odometer');
    return [regOf[v.vehicle_id] + tag,
            measurable ? Math.round(km).toLocaleString() : '—',
            sym + Math.round(fSpend).toLocaleString(), sym + Math.round(mSpend).toLocaleString(),
            downtime || ''];
  });
  rows.push(['TOTAL', Math.round(tKm).toLocaleString(),
             sym + Math.round(tFuel).toLocaleString(), sym + Math.round(tMaint).toLocaleString(), '']);

  var body = sec_('🚌 The last 7 days (km approximate)', ['Vehicle', 'Km', 'Fuel', 'Maintenance', 'Days off road'], rows);

  // Vehicles to watch (same signal as the dashboard).
  const summary = computeSummaryRows_();
  const watch = computeWatchList_(summary.byVehicle, summary.regOf, settings);
  if (watch.length) {
    body += sec_('🚨 Vehicles to watch', ['Vehicle', 'Why'],
      watch.map(function (w) { return [w.reg_no, w.reasons.join('; ')]; }));
  }

  const service = computeServiceDue_(active, regOf, settings);
  if (service.noDateSet) {
    body += sec_('🔧 Service due', ['Status'], [['No service due date is set — see Settings.']]);
  } else {
    const serviceRows = service.due.slice();
    if (service.unknownCount) {
      serviceRows.push([service.unknownCount + ' vehicle(s) with no maintenance history', 'Unknown']);
    }
    if (serviceRows.length) body += sec_('🔧 Service due', ['Vehicle', 'Status'], serviceRows);
  }

  const docs = upcomingExpiries_(regOf, settings);
  if (docs.length) {
    body += sec_('📄 Documents expiring', ['Vehicle', 'Document', 'Expires'],
      docs.map(function (e) { return [e.reg_no, e.doc_type, e.expiry]; }));
  }

  sendFleetEmail_('Fleet weekly digest — ' + Utilities.formatDate(new Date(), TZ_(), 'dd MMM yyyy'),
    'Weekly digest', body);
  try { SpreadsheetApp.getActive().toast('Weekly digest emailed.', 'Fleet', 4); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Monthly report — last month's summary, emailed on the 1st
// ---------------------------------------------------------------------------

function monthlyReport() {
  const settings = getSettings();
  if (String(settings.monthly_report || 'Yes').toLowerCase().indexOf('n') === 0) return;
  const sym = settings.currency_symbol || '₹';

  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  const mk = monthKey_(d);
  const rows = computeSummaryRows_().rows.filter(function (r) { return r.month === mk; });
  if (!rows.length) {
    try { SpreadsheetApp.getActive().toast('No data for ' + monthLabel_(mk) + ' — no report sent.', 'Fleet', 5); } catch (e) {}
    return;
  }

  // The TOTAL line's cost/km leaves out vehicles we could not measure, so the
  // fleet figure is not skewed by fuel spend with no distance to divide by.
  var tKm = 0, tFuel = 0, tMaint = 0, tDown = 0, blind = 0;
  const table = rows.map(function (r) {
    if (r.unmeasured) blind++;
    else { tKm += r.km || 0; tFuel += r.fuel_cost || 0; tMaint += r.maint_cost || 0; }
    tDown += r.downtime_days || 0;
    return [r.reg_no + (r.unmeasured ? ' 🚫' : ''),
            r.km === '' ? '—' : Math.round(r.km).toLocaleString(),
            sym + Math.round(r.fuel_cost).toLocaleString(),
            r.efficiency_kmpl === '' ? '—' : r.efficiency_kmpl + ' km/L',
            sym + Math.round(r.maint_cost).toLocaleString(),
            r.total_cost_per_km === '' ? '—' : sym + r.total_cost_per_km + '/km',
            r.downtime_days || ''];
  });
  table.push(['TOTAL (measured)', Math.round(tKm).toLocaleString(), sym + Math.round(tFuel).toLocaleString(), '',
              sym + Math.round(tMaint).toLocaleString(),
              tKm > 0 ? sym + ((tFuel + tMaint) / tKm).toFixed(2) + '/km' : '—', tDown || '']);

  var body = sec_('📊 ' + monthLabel_(mk) + ' — per vehicle',
    ['Vehicle', 'Km', 'Fuel', 'Efficiency', 'Maintenance', 'Total cost', 'Days off road'], table);
  if (blind) {
    body += '<p style="color:#8A8398;font-size:13px">🚫 ' + blind + ' vehicle(s) had no working odometer this ' +
            'month. Their fuel and maintenance spend is listed, but they are left out of the km and cost/km totals.</p>';
  }

  sendFleetEmail_('Fleet monthly report — ' + monthLabel_(mk), 'Monthly report', body);
  try { SpreadsheetApp.getActive().toast('Monthly report emailed.', 'Fleet', 4); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Nightly backup — a dated copy of the whole spreadsheet in Drive
// ---------------------------------------------------------------------------

function nightlyBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const keep = parseInt(getSetting_('backup_keep', '30'), 10) || 30;

  const it = DriveApp.getFoldersByName('Fleet Tracker Backups');
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder('Fleet Tracker Backups');

  const name = ss.getName() + ' — backup ' + Utilities.formatDate(new Date(), TZ_(), 'yyyy-MM-dd HH:mm');
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);

  // Keep only the newest `keep` copies; older ones go to the bin.
  const files = [];
  const fit = folder.getFiles();
  while (fit.hasNext()) files.push(fit.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (var i = keep; i < files.length; i++) files[i].setTrashed(true);

  try { SpreadsheetApp.getActive().toast('Backup saved to Drive → Fleet Tracker Backups.', 'Fleet', 4); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Shared email helpers (pastel styling to match the app)
// ---------------------------------------------------------------------------

function sendFleetEmail_(subject, heading, sectionsHtml) {
  const to = getSetting_('alert_email', '') || Session.getEffectiveUser().getEmail();
  if (!to) return;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#3F3A52;max-width:640px">' +
    '<h2 style="color:#4A3F6B">' + heading + '</h2>' + sectionsHtml +
    '<p style="color:#8A8398;font-size:12px">Sent automatically by your Fleet Tracker.</p></div>';
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html });
}

function sec_(title, headers, rows) {
  var h = '<h3 style="color:#4A3F6B;margin:18px 0 8px">' + title + '</h3>' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<tr style="background:#E8E1F5;color:#3F3A52">' + headers.map(th_).join('') + '</tr>';
  rows.forEach(function (r, i) {
    h += '<tr style="background:' + (i % 2 ? '#F7F4FB' : '#FFFFFF') + '">' + r.map(td_).join('') + '</tr>';
  });
  return h + '</table>';
}

function th_(t) { return '<th style="padding:8px 12px;text-align:left;font-size:13px">' + t + '</th>'; }
function td_(t) { return '<td style="padding:8px 12px;font-size:13px">' + t + '</td>'; }
