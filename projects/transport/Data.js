/**
 * Data.gs — reading and writing rows, plus the functions the web app calls.
 *
 * Everything the app saves goes through here so the same guard rails
 * (required fields, odometer never going backwards) apply every time.
 */

// ---- Low-level helpers -----------------------------------------------------

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" is missing. Run Fleet → Set up workbook.');
  return sh;
}

// One save touches several tabs (odometer check, duplicate check, append).
// This memo makes each tab read from the Sheet only once per request,
// which keeps the app quick as the logs grow.
var ROWS_MEMO_ = {};

/**
 * How many columns we can actually read from a tab.
 *
 * When new code adds a column but setupWorkbook() has not been run yet, the
 * sheet is narrower than HEADERS. Asking for more columns than exist throws,
 * which would take the whole app down for drivers as well as admins — so read
 * what is there and let the missing trailing fields come back blank.
 */
function readableCols_(sh, headers) {
  return Math.min(headers.length, Math.max(1, sh.getMaxColumns()));
}

/** Read a tab into an array of objects keyed by the header names. */
function getRows_(name) {
  if (ROWS_MEMO_[name]) return ROWS_MEMO_[name];
  const sh = sheet_(name);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) { ROWS_MEMO_[name] = []; return ROWS_MEMO_[name]; }
  const headers = HEADERS[name];
  const cols = readableCols_(sh, headers);
  const values = sh.getRange(2, 1, lastRow - 1, cols).getValues();
  ROWS_MEMO_[name] = values.map(function (row) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = (i < cols) ? row[i] : ''; });
    return o;
  }).filter(function (o) {
    // drop fully blank rows
    return Object.keys(o).some(function (k) { return o[k] !== '' && o[k] !== null; });
  });
  return ROWS_MEMO_[name];
}

/** Append one object as a row, in the tab's column order. */
function appendRow_(name, obj) {
  const sh = sheet_(name);
  const row = HEADERS[name].map(function (h) {
    return (obj[h] === undefined || obj[h] === null) ? '' : obj[h];
  });
  sh.appendRow(row);
  delete ROWS_MEMO_[name];
  ODO_CTX_MEMO_ = {};
}

/**
 * Append many objects in ONE write.
 * Marking a day of attendance is ~35 rows; doing that through appendRow_ would
 * be 35 round trips and 35 cache flushes.
 */
function appendRows_(name, objs) {
  if (!objs || !objs.length) return 0;
  const sh = sheet_(name);
  const headers = HEADERS[name];
  const cols = readableCols_(sh, headers);
  const values = objs.map(function (obj) {
    return headers.slice(0, cols).map(function (h) {
      return (obj[h] === undefined || obj[h] === null) ? '' : obj[h];
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, cols).setValues(values);
  delete ROWS_MEMO_[name];
  ODO_CTX_MEMO_ = {};
  return values.length;
}

function toNum_(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function isBlank_(v) { return v === undefined || v === null || String(v).trim() === ''; }
function yes_(v) { return String(v == null ? '' : v).trim().toLowerCase().indexOf('y') === 0; }
function parseDate_(v) {
  if (v instanceof Date) return v;
  if (isBlank_(v)) return null;
  const parts = String(v).split('-');
  if (parts.length === 3) return new Date(+parts[0], +parts[1] - 1, +parts[2]);
  const d = new Date(v); return isNaN(d.getTime()) ? null : d;
}
function startOfDay_(d) { const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }
function daysBetween_(from, to) { return Math.max(0, Math.round((startOfDay_(to) - startOfDay_(from)) / 86400000)); }

/** Generate the next id like V001, D001. */
function nextId_(sheetName, idCol, prefix) {
  const rows = getRows_(sheetName);
  var max = 0;
  rows.forEach(function (r) {
    const m = String(r[idCol] || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + ('000' + (max + 1)).slice(-3);
}

/** A unique id for a log row, so it can be edited or voided later. */
function newEntryId_() {
  return 'E' + Date.now().toString(36).toUpperCase() + '-' +
         Math.floor(Math.random() * 1679616).toString(36).toUpperCase();
}

function isVoided_(r) { return String(r.voided || '').toLowerCase().indexOf('y') === 0; }

/** Update the one row whose idCol matches idVal, setting only the keys in patch. */
function updateRowById_(name, idCol, idVal, patch) {
  const sh = sheet_(name);
  const headers = HEADERS[name];
  const idIdx = headers.indexOf(idCol);
  const last = sh.getLastRow();
  if (idIdx < 0 || last < 2) return false;
  const cols = readableCols_(sh, headers);
  if (idIdx >= cols) return false; // column not built yet — run setupWorkbook
  const data = sh.getRange(2, 1, last - 1, cols).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(idVal).trim()) {
      headers.forEach(function (h, c) {
        if (c < cols && Object.prototype.hasOwnProperty.call(patch, h)) {
          data[i][c] = (patch[h] == null ? '' : patch[h]);
        }
      });
      sh.getRange(2 + i, 1, 1, cols).setValues([data[i]]);
      delete ROWS_MEMO_[name];
      ODO_CTX_MEMO_ = {};
      return true;
    }
  }
  return false;
}

// ---- Duplicate detection ---------------------------------------------------

/** Normalise a value so "42", 42, " 42 " and a Date all compare cleanly. */
function normVal_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ_(), 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  if (s === '') return '';
  const n = parseFloat(s);
  if (!isNaN(n) && isFinite(s)) return String(n);
  return s.toLowerCase();
}

/** True if a non-voided row already exists for this vehicle with identical key details. */
function findDuplicate_(name, candidate, keys) {
  const rows = getRows_(name);
  for (var i = 0; i < rows.length; i++) {
    if (isVoided_(rows[i])) continue;
    var same = true;
    for (var j = 0; j < keys.length; j++) {
      if (normVal_(rows[i][keys[j]]) !== normVal_(candidate[keys[j]])) { same = false; break; }
    }
    if (same) return true;
  }
  return false;
}

// ---- Settings --------------------------------------------------------------

function getSettings() {
  const rows = getRows_(SHEETS.SETTINGS);
  const o = {};
  rows.forEach(function (r) { o[r.setting] = r.value; });
  return o;
}

function getSetting_(key, fallback) {
  const v = getSettings()[key];
  return (v === undefined || v === '') ? fallback : v;
}

// ---- Bootstrap for the web app --------------------------------------------

/** Called once when the app loads: gives it everything it needs to populate dropdowns. */
function getBootstrap() {
  const today = new Date();
  const vehicles = getRows_(SHEETS.VEHICLES)
    .filter(function (v) { return !isBlank_(v.vehicle_id) && String(v.status).toLowerCase() !== 'retired'; })
    .map(function (v) {
      // Off-road vehicles stay in the pickers on purpose — a bus at the garage
      // still gets fuelled and towed. The app tags them instead of hiding them.
      const since  = parseDate_(v.off_road_since);
      const broken = parseDate_(v.odo_broken_since);
      return {
        vehicle_id: v.vehicle_id, reg_no: v.reg_no, make_model: v.make_model, status: v.status,
        off_road: isOffRoad_(v),
        off_road_since: since ? Utilities.formatDate(since, TZ_(), 'dd MMM') : '',
        off_road_days: since ? daysBetween_(since, today) : null,
        odo_working: odoWorks_(v),
        odo_broken_since: broken ? Utilities.formatDate(broken, TZ_(), 'dd MMM') : '',
        odo_broken_days: broken ? daysBetween_(broken, today) : null,
        route_no: v.route_no || ''
      };
    });
  const drivers = getRows_(SHEETS.DRIVERS)
    .filter(function (d) { return !isBlank_(d.driver_id) && String(d.status).toLowerCase() !== 'retired'; })
    .map(function (d) {
      return { driver_id: d.driver_id, name: d.name, assigned_vehicle: d.assigned_vehicle };
    });
  const staff = getRows_(SHEETS.STAFF)
    .filter(function (s) { return !isBlank_(s.name) && String(s.active).toLowerCase() !== 'no'; })
    .map(function (s) { return s.name; });
  return {
    settings: getSettings(),
    vehicles: vehicles,
    drivers: drivers,
    staff: staff,
    choices: CHOICES,
    // Suggest the next bill number so the in-charge is not copying a running
    // series off the previous voucher by hand.
    nextBillNo: nextBillNo_()
  };
}

/**
 * One past the highest bill number we have seen, as a suggestion only.
 * The office's series is sequential but has real gaps, so this is pre-filled
 * and always editable — never enforced.
 */
function nextBillNo_() {
  var max = null;
  getRows_(SHEETS.FUEL).forEach(function (r) {
    if (isVoided_(r)) return;
    const m = String(r.bill_no || '').match(/(\d+)\s*$/);
    if (m) { const n = parseInt(m[1], 10); if (max === null || n > max) max = n; }
  });
  return max === null ? '' : String(max + 1);
}

// ---- Vehicle state: off road, and whether the odometer works ---------------
//
// Two facts live on every vehicle:
//   status = "Under maintenance"  → the bus is off road
//   odo_working = No              → its odometer is out of action
//
// Both are CURRENT state on Vehicle_Master, written only by the functions in
// this section. The history that the maths needs — when the meter broke, when
// it came back, and whether it came back on a new unit that started from zero —
// is the append-only Odometer_Events log.

/** The whole vehicle row, or null. */
function vehicleById_(id) {
  const rows = getRows_(SHEETS.VEHICLES);
  for (var i = 0; i < rows.length; i++) if (rows[i].vehicle_id === id) return rows[i];
  return null;
}

function isOffRoad_(v) {
  return String((v && v.status) || '').trim().toLowerCase() === STATUS_OFF_ROAD.toLowerCase();
}

/** False only when the vehicle is explicitly marked "odometer not working". */
function odoWorks_(idOrRow) {
  const v = (idOrRow && typeof idOrRow === 'object') ? idOrRow : vehicleById_(idOrRow);
  if (!v) return true;
  return String(v.odo_working || 'Yes').trim().toLowerCase().indexOf('n') !== 0;
}

var ODO_CTX_MEMO_ = {};

/**
 * Everything the maths needs to know about one vehicle's odometer:
 *   broken  — [{from, to}] stretches with no readings (to = null while still broken)
 *   eraFrom — the day a replacement meter took over, if one ever did
 *   eraBase — what that replacement meter read on the day it took over
 *
 * Readings dated before eraFrom came off a different physical meter, so they
 * must never be compared against, or subtracted from, readings after it.
 */
function odoContext_(vehicleId) {
  if (ODO_CTX_MEMO_[vehicleId]) return ODO_CTX_MEMO_[vehicleId];
  // An older workbook has no Odometer_Events tab yet. Treat that as "nothing has
  // ever happened to any meter" rather than bringing the whole app down; running
  // Fleet → Set up workbook creates it.
  var raw = [];
  try { raw = getRows_(SHEETS.ODO); } catch (e) { raw = []; }
  const events = raw
    .filter(function (r) { return r.vehicle_id === vehicleId && parseDate_(r.date); })
    .map(function (r) {
      return {
        date: startOfDay_(parseDate_(r.date)),
        event: String(r.event || '').trim().toLowerCase(),
        reading: toNum_(r.reading),
        reset: yes_(r.was_reset)
      };
    })
    .sort(function (a, b) { return a.date - b.date; });

  const broken = [];
  var eraFrom = null, eraBase = null;
  events.forEach(function (e) {
    const open = broken.length ? broken[broken.length - 1] : null;
    if (e.event === 'broken') {
      if (!open || open.to !== null) broken.push({ from: e.date, to: null });
    } else if (e.event === 'working') {
      if (open && open.to === null) open.to = e.date;
      if (e.reset) { eraFrom = e.date; eraBase = e.reading; } // newest reset wins
    }
  });
  ODO_CTX_MEMO_[vehicleId] = { broken: broken, eraFrom: eraFrom, eraBase: eraBase };
  return ODO_CTX_MEMO_[vehicleId];
}

/** True if the stretch between two readings crosses a dead meter or a meter change. */
function spansOdoGap_(ctx, from, to) {
  if (ctx.eraFrom && from < ctx.eraFrom && to >= ctx.eraFrom) return true;
  return ctx.broken.some(function (w) {
    return (w.to === null) ? (to > w.from) : (from < w.to && to > w.from);
  });
}

// ---- Odometer guard --------------------------------------------------------

/**
 * Highest odometer reading we have for a vehicle, across all logs.
 * Readings from a meter that has since been replaced are ignored — otherwise a
 * bus fitted with a fresh unit would trip the "lower than last reading" warning
 * on every entry for the rest of its life.
 */
function getLastOdometer(vehicleId) {
  if (isBlank_(vehicleId)) return null;
  const ctx = odoContext_(vehicleId);
  var max = null;
  function consider(dateVal, v) {
    const n = toNum_(v);
    if (n === null) return;
    const d = parseDate_(dateVal);
    if (ctx.eraFrom && d && startOfDay_(d) < ctx.eraFrom) return; // belongs to the old meter
    if (max === null || n > max) max = n;
  }
  getRows_(SHEETS.FUEL).forEach(function (r) { if (r.vehicle_id === vehicleId && !isVoided_(r)) consider(r.date, r.odometer); });
  getRows_(SHEETS.MAINT).forEach(function (r) { if (r.vehicle_id === vehicleId && !isVoided_(r)) consider(r.date, r.odometer); });
  getRows_(SHEETS.TRIP).forEach(function (r) {
    if (r.vehicle_id === vehicleId && !isVoided_(r)) { consider(r.date, r.open_odo); consider(r.date, r.close_odo); }
  });
  // What a replacement meter showed on day one is itself a floor.
  if (ctx.eraBase !== null && (max === null || ctx.eraBase > max)) max = ctx.eraBase;
  return max;
}

function checkOdometer_(vehicleId, odo, override) {
  const last = getLastOdometer(vehicleId);
  if (last !== null && odo < last && !override) {
    return 'That odometer (' + odo + ') is lower than the last recorded reading (' + last +
           ') for this vehicle. Tick "save anyway" if it is correct.';
  }
  return null;
}

// ---- Logging entries (open to everyone — drivers + admin) ------------------
// Each one checks for an exact duplicate first and skips it, per your request.

/** Diesel and petrol move the bus; AdBlue and the rest are just consumables. */
function isPropellant_(product) {
  const p = String(product || 'Diesel').trim().toLowerCase();
  return FUEL_PRODUCTS.some(function (x) { return x.toLowerCase() === p; });
}

function addFuel(d) {
  try {
    if (isBlank_(d.vehicle_id)) return fail_('Pick a vehicle.');
    const product = isBlank_(d.product) ? 'Diesel' : String(d.product).trim();
    if (CHOICES.product.indexOf(product) < 0) return fail_('Unknown product "' + product + '".');
    const propellant = isPropellant_(product);
    const works = odoWorks_(d.vehicle_id);
    const odo = toNum_(d.odometer);
    // A vehicle whose odometer is out of action still gets its fuel logged —
    // we just cannot ask it for a reading. Nor does a can of AdBlue move it,
    // so there is no reading to take for one of those either.
    if (works && propellant && odo === null) return fail_('Odometer reading is required.');
    if (toNum_(d.amount) === null) return fail_('Amount is required.');
    if (odo !== null && propellant) {
      const warn = checkOdometer_(d.vehicle_id, odo, d.override);
      if (warn) return fail_(warn);
    }
    const date = parseDate_(d.date) || new Date();
    const cand = { vehicle_id: d.vehicle_id, date: date, odometer: odo, litres: toNum_(d.litres),
                   amount: toNum_(d.amount), bill_no: d.bill_no, product: product };
    // bill_no joins the duplicate key so two genuine fills on one day are told
    // apart — but one bill can legitimately span two rows (a fill plus AdBlue),
    // which the litres/amount/product parts of the key already separate.
    if (findDuplicate_(SHEETS.FUEL, cand, ['vehicle_id', 'date', 'odometer', 'litres', 'amount', 'bill_no', 'product']))
      return skipped_('That exact fuel entry is already saved — skipped a duplicate.');
    appendRow_(SHEETS.FUEL, {
      timestamp: new Date(), date: date, vehicle_id: d.vehicle_id, odometer: odo,
      litres: cand.litres, amount: cand.amount, filled_to_full: propellant ? (d.filled_to_full || 'No') : 'No',
      station: d.station, paid_by: d.paid_by, driver_id: d.driver_id, entered_by: d.entered_by,
      entry_id: newEntryId_(), voided: '', edited_by: '', edited_at: '',
      bill_no: d.bill_no, product: product, reported_in: ''
    });
    if (!propellant) return ok_(product + ' entry saved. It counts toward spend, but not toward km/L.');
    return ok_(works ? 'Fuel entry saved.'
                     : 'Fuel entry saved. No reading taken — this vehicle\'s odometer is marked not working.');
  } catch (e) { return fail_(e.message); }
}

function addMaintenance(d) {
  try {
    if (isBlank_(d.vehicle_id)) return fail_('Pick a vehicle.');
    const works = odoWorks_(d.vehicle_id);
    const odo = toNum_(d.odometer);
    if (works && odo === null) return fail_('Odometer reading is required.');
    if (isBlank_(d.description)) return fail_('Describe the work done.');
    if (odo !== null) {
      const warn = checkOdometer_(d.vehicle_id, odo, d.override);
      if (warn) return fail_(warn);
    }
    const date = parseDate_(d.date) || new Date();
    const cand = { vehicle_id: d.vehicle_id, date: date, odometer: odo, category: d.category,
                   description: d.description, parts: toNum_(d.parts) || 0, labour: toNum_(d.labour) || 0 };
    if (findDuplicate_(SHEETS.MAINT, cand, ['vehicle_id', 'date', 'odometer', 'category', 'description', 'parts', 'labour']))
      return skipped_('That exact maintenance entry is already saved — skipped a duplicate.');
    const entryId = newEntryId_();
    appendRow_(SHEETS.MAINT, {
      timestamp: new Date(), date: date, vehicle_id: d.vehicle_id, odometer: odo,
      category: d.category, description: d.description, parts: cand.parts, labour: cand.labour,
      vendor: d.vendor, approval_ref: d.approval_ref, downtime_days: toNum_(d.downtime_days) || 0,
      entered_by: d.entered_by, entry_id: entryId, voided: '', edited_by: '', edited_at: ''
    });
    // One action, two outputs: the job is logged AND the bus goes off road,
    // with this entry remembered as the one that will carry the downtime.
    var extra = '';
    if (yes_(d.off_road)) {
      const r = setOffRoad_(d.vehicle_id, date, entryId, d.entered_by);
      if (r.ok) extra = ' ' + r.message;
    }
    return ok_('Maintenance entry saved (this is your approval note too).' + extra);
  } catch (e) { return fail_(e.message); }
}

function addTrip(d) {
  try {
    if (isBlank_(d.vehicle_id)) return fail_('Pick a vehicle.');
    const works = odoWorks_(d.vehicle_id);
    const open = toNum_(d.open_odo), close = toNum_(d.close_odo);
    if (works && (open === null || close === null)) return fail_('Both opening and closing odometer are required.');
    if (open !== null && close !== null && close < open) return fail_('Closing odometer cannot be less than opening.');
    const date = parseDate_(d.date) || new Date();
    const distance = (open !== null && close !== null) ? close - open : '';
    const cand = { vehicle_id: d.vehicle_id, date: date, open_odo: open, close_odo: close, purpose: d.purpose };
    if (findDuplicate_(SHEETS.TRIP, cand, ['vehicle_id', 'date', 'open_odo', 'close_odo', 'purpose']))
      return skipped_('That exact trip is already saved — skipped a duplicate.');
    appendRow_(SHEETS.TRIP, {
      timestamp: new Date(), date: date, vehicle_id: d.vehicle_id, driver_id: d.driver_id,
      purpose: d.purpose, open_odo: open, close_odo: close, distance: distance,
      start_time: d.start_time, end_time: d.end_time, entered_by: d.entered_by,
      entry_id: newEntryId_(), voided: '', edited_by: '', edited_at: ''
    });
    return ok_(distance === ''
      ? 'Trip saved. No distance worked out — this vehicle\'s odometer is marked not working.'
      : 'Trip saved (' + distance + ' km).');
  } catch (e) { return fail_(e.message); }
}

// ---- Off road / back on road ----------------------------------------------
// Open to everyone, like the entry forms: the in-charge marks a bus off road
// from the maintenance screen, and back on from the home screen.

/** Shared by the maintenance form's toggle and the standalone endpoint. */
function setOffRoad_(vehicleId, date, entryId, who) {
  const v = vehicleById_(vehicleId);
  if (!v) return fail_('Could not find that vehicle.');
  if (isOffRoad_(v)) return ok_('Already marked off road.');
  const ok = updateRowById_(SHEETS.VEHICLES, 'vehicle_id', vehicleId, {
    status: STATUS_OFF_ROAD,
    off_road_since: startOfDay_(date || new Date()),
    off_road_entry_id: entryId || '',
    edited_by: who || 'App', edited_at: new Date()
  });
  return ok ? ok_((v.reg_no || vehicleId) + ' is now marked off road.')
            : fail_('Could not update that vehicle.');
}

function setVehicleOffRoad(d) {
  try {
    if (isBlank_(d.vehicle_id)) return fail_('Pick a vehicle.');
    return setOffRoad_(d.vehicle_id, parseDate_(d.date) || new Date(), d.entry_id, d.entered_by);
  } catch (e) { return fail_(e.message); }
}

/**
 * The maintenance entry that should carry this off-road spell's downtime:
 * the one that put the bus off road, or failing that the newest non-voided
 * maintenance entry logged for it since it went off road.
 */
function offRoadJob_(v) {
  const rows = getRows_(SHEETS.MAINT).filter(function (r) {
    return r.vehicle_id === v.vehicle_id && !isVoided_(r) && !isBlank_(r.entry_id);
  });
  var hit = null;
  if (!isBlank_(v.off_road_entry_id)) {
    hit = rows.filter(function (r) {
      return String(r.entry_id).trim() === String(v.off_road_entry_id).trim();
    })[0] || null;
  }
  if (!hit) {
    const since = parseDate_(v.off_road_since);
    hit = rows.filter(function (r) {
      const d = parseDate_(r.date);
      return d && (!since || startOfDay_(d) >= startOfDay_(since));
    }).sort(function (a, b) { return parseDate_(b.date) - parseDate_(a.date); })[0] || null;
  }
  if (!hit) return null;
  return {
    entry_id: hit.entry_id,
    label: String(hit.description || hit.category || 'maintenance entry').slice(0, 48)
  };
}

/** What the "back on road?" prompt needs: how long, and which job gets the days. */
function getOffRoadInfo(vehicleId) {
  const v = vehicleById_(vehicleId);
  if (!v) return fail_('Could not find that vehicle.');
  if (!isOffRoad_(v)) return fail_('That vehicle is not marked off road.');
  const since = parseDate_(v.off_road_since);
  const job = offRoadJob_(v);
  return {
    ok: true,
    vehicle_id: vehicleId,
    reg_no: v.reg_no || vehicleId,
    since: since ? Utilities.formatDate(since, TZ_(), 'yyyy-MM-dd') : '',
    since_label: since ? Utilities.formatDate(since, TZ_(), 'dd MMM yyyy') : '',
    days: since ? daysBetween_(since, new Date()) : null,
    job_label: job ? job.label : ''
  };
}

function setVehicleOnRoad(d) {
  try {
    const v = vehicleById_(d.vehicle_id);
    if (!v) return fail_('Could not find that vehicle.');
    if (!isOffRoad_(v)) return ok_('That vehicle is already on the road.');
    const back = parseDate_(d.date) || new Date();
    const since = parseDate_(v.off_road_since);
    if (since && startOfDay_(back) < startOfDay_(since)) {
      return fail_('The return date cannot be before it went off road (' +
                   Utilities.formatDate(since, TZ_(), 'dd MMM yyyy') + ').');
    }
    // Days off road: whatever the in-charge confirmed, else the span we counted.
    var days = toNum_(d.downtime_days);
    if (days === null && since) days = daysBetween_(since, back);

    var note = '';
    const job = offRoadJob_(v);
    if (job && days !== null) {
      updateRowById_(SHEETS.MAINT, 'entry_id', job.entry_id, {
        downtime_days: days, edited_by: d.entered_by || 'App', edited_at: new Date()
      });
      note = ' ' + days + ' day' + (days === 1 ? '' : 's') + ' off road recorded against "' + job.label + '".';
    } else if (days !== null) {
      note = ' There is no maintenance entry to hang the ' + days + ' day' + (days === 1 ? '' : 's') +
             ' on — add one so the downtime counts towards the replace signal.';
    }

    const ok = updateRowById_(SHEETS.VEHICLES, 'vehicle_id', d.vehicle_id, {
      status: 'Active', off_road_since: '', off_road_entry_id: '',
      edited_by: d.entered_by || 'App', edited_at: new Date()
    });
    return ok ? ok_((v.reg_no || d.vehicle_id) + ' is back on the road.' + note)
              : fail_('Could not update that vehicle.');
  } catch (e) { return fail_(e.message); }
}

// ---- Odometer working / not working ----------------------------------------

function markOdometerBroken(d) {
  try {
    const v = vehicleById_(d.vehicle_id);
    if (!v) return fail_('Pick a vehicle.');
    if (!odoWorks_(v)) return ok_('That odometer is already marked as not working.');
    const date = startOfDay_(parseDate_(d.date) || new Date());
    appendRow_(SHEETS.ODO, {
      timestamp: new Date(), date: date, vehicle_id: d.vehicle_id, event: 'Broken',
      reading: '', was_reset: '', note: d.note || '', entered_by: d.entered_by || ''
    });
    updateRowById_(SHEETS.VEHICLES, 'vehicle_id', d.vehicle_id, {
      odo_working: 'No', odo_broken_since: date,
      edited_by: d.entered_by || 'App', edited_at: new Date()
    });
    return ok_('Odometer marked not working on ' + (v.reg_no || d.vehicle_id) +
               '. Entries no longer ask for a reading — km, cost/km and km/L pause until it is fixed.');
  } catch (e) { return fail_(e.message); }
}

function markOdometerWorking(d) {
  try {
    const v = vehicleById_(d.vehicle_id);
    if (!v) return fail_('Pick a vehicle.');
    const reading = toNum_(d.reading);
    if (reading === null) return fail_('What does the odometer read now? That number is where counting starts again.');
    if (reading < 0) return fail_('An odometer reading cannot be negative.');
    const date = startOfDay_(parseDate_(d.date) || new Date());

    // Lower than the old meter's last reading means the unit was replaced and
    // has started again. Record that as a reset so the "lower than last reading"
    // guard and the km maths both start afresh from this number.
    const previous = getLastOdometer(d.vehicle_id);
    const wasReset = previous !== null && reading < previous;

    appendRow_(SHEETS.ODO, {
      timestamp: new Date(), date: date, vehicle_id: d.vehicle_id, event: 'Working',
      reading: reading, was_reset: wasReset ? 'Yes' : '',
      note: wasReset ? ('New meter — the old one last read ' + previous) : (d.note || ''),
      entered_by: d.entered_by || ''
    });
    updateRowById_(SHEETS.VEHICLES, 'vehicle_id', d.vehicle_id, {
      odo_working: 'Yes', odo_broken_since: '',
      edited_by: d.entered_by || 'App', edited_at: new Date()
    });
    return ok_(wasReset
      ? 'Odometer working again on a new meter reading ' + reading + ' km. Counting starts from there — ' +
        'the old readings stay on record but are never compared against the new ones.'
      : 'Odometer working again on ' + (v.reg_no || d.vehicle_id) + ' at ' + reading + ' km.');
  } catch (e) { return fail_(e.message); }
}

// ---- Vehicles, drivers, documents (ADMIN only) -----------------------------

function addVehicle(token, d) {
  const who = adminName_(token); if (!who) return needAdmin_();
  try {
    if (isBlank_(d.reg_no)) return fail_('Registration number is required.');
    const id = isBlank_(d.vehicle_id) ? nextId_(SHEETS.VEHICLES, 'vehicle_id', 'V') : d.vehicle_id;
    const status = d.status || 'Active';
    const off = status.trim().toLowerCase() === STATUS_OFF_ROAD.toLowerCase();
    const odoOk = isBlank_(d.odo_working) || yes_(d.odo_working);
    const today = startOfDay_(new Date());
    appendRow_(SHEETS.VEHICLES, {
      vehicle_id: id, reg_no: d.reg_no, make_model: d.make_model, type: d.type,
      seating: toNum_(d.seating), year: toNum_(d.year), in_service_date: parseDate_(d.in_service_date),
      status: status, gps_device_id: d.gps_device_id, access_card_id: d.access_card_id,
      route_no: d.route_no,
      edited_by: who, edited_at: new Date(),
      off_road_since: off ? today : '', off_road_entry_id: '',
      odo_working: odoOk ? 'Yes' : 'No', odo_broken_since: odoOk ? '' : today
    });
    if (!odoOk) {
      appendRow_(SHEETS.ODO, {
        timestamp: new Date(), date: today, vehicle_id: id, event: 'Broken',
        reading: '', was_reset: '', note: 'Added with the odometer already out of action', entered_by: who
      });
    }
    return ok_('Vehicle ' + id + ' added.');
  } catch (e) { return fail_(e.message); }
}

function updateVehicle(token, id, d) {
  const who = adminName_(token); if (!who) return needAdmin_();
  try {
    if (isBlank_(d.reg_no)) return fail_('Registration number is required.');
    const before = vehicleById_(id);
    if (!before) return fail_('Could not find that vehicle.');

    const status  = d.status || 'Active';
    const goesOff = status.trim().toLowerCase() === STATUS_OFF_ROAD.toLowerCase();
    const wasOff  = isOffRoad_(before);

    const patch = {
      reg_no: d.reg_no, make_model: d.make_model, type: d.type, seating: toNum_(d.seating),
      year: toNum_(d.year), in_service_date: parseDate_(d.in_service_date), status: status,
      gps_device_id: d.gps_device_id, access_card_id: d.access_card_id, route_no: d.route_no,
      edited_by: who, edited_at: new Date()
    };
    // Keep off_road_since in step with whatever the status now says.
    if (goesOff && !wasOff) patch.off_road_since = parseDate_(d.off_road_since) || startOfDay_(new Date());
    else if (!goesOff && wasOff) { patch.off_road_since = ''; patch.off_road_entry_id = ''; }

    if (!updateRowById_(SHEETS.VEHICLES, 'vehicle_id', id, patch)) return fail_('Could not find that vehicle.');

    // The odometer flag is a logged event, not just a cell — route any change
    // through the same functions the entry screens use, so the history matches.
    var extra = '';
    const wantsWorking = isBlank_(d.odo_working) || yes_(d.odo_working);
    if (!wantsWorking && odoWorks_(before)) {
      const b = markOdometerBroken({ vehicle_id: id, date: d.odo_broken_since, entered_by: who });
      extra = b.ok ? ' Odometer marked not working.' : ' (Odometer flag not saved: ' + b.error + ')';
    } else if (wantsWorking && !odoWorks_(before)) {
      const w = markOdometerWorking({ vehicle_id: id, reading: d.odo_reading, entered_by: who });
      if (!w.ok) return fail_('Vehicle details saved, but the odometer is still marked not working: ' + w.error);
      extra = ' ' + w.message;
    }
    if (goesOff && !wasOff) extra += ' Marked off road.';
    if (!goesOff && wasOff) extra += ' Back on road — add the days off road to its maintenance entry if it matters.';
    return ok_('Vehicle updated.' + extra);
  } catch (e) { return fail_(e.message); }
}

function retireVehicle(token, id) {
  const who = adminName_(token); if (!who) return needAdmin_();
  const ok = updateRowById_(SHEETS.VEHICLES, 'vehicle_id', id, {
    status: 'Retired', off_road_since: '', off_road_entry_id: '', edited_by: who, edited_at: new Date()
  });
  return ok ? ok_('Vehicle retired (hidden from pickers, history kept).') : fail_('Could not find that vehicle.');
}

function addDriver(token, d) {
  const who = adminName_(token); if (!who) return needAdmin_();
  try {
    if (isBlank_(d.name)) return fail_('Driver name is required.');
    const id = isBlank_(d.driver_id) ? nextId_(SHEETS.DRIVERS, 'driver_id', 'D') : d.driver_id;
    appendRow_(SHEETS.DRIVERS, {
      driver_id: id, name: d.name, licence_no: d.licence_no, licence_expiry: parseDate_(d.licence_expiry),
      phone: d.phone, assigned_vehicle: d.assigned_vehicle, status: d.status || 'Active',
      sort_order: toNum_(d.sort_order),
      edited_by: who, edited_at: new Date()
    });
    return ok_('Driver ' + id + ' added.');
  } catch (e) { return fail_(e.message); }
}

function updateDriver(token, id, d) {
  const who = adminName_(token); if (!who) return needAdmin_();
  try {
    if (isBlank_(d.name)) return fail_('Driver name is required.');
    const ok = updateRowById_(SHEETS.DRIVERS, 'driver_id', id, {
      name: d.name, licence_no: d.licence_no, licence_expiry: parseDate_(d.licence_expiry),
      phone: d.phone, assigned_vehicle: d.assigned_vehicle, status: d.status || 'Active',
      sort_order: toNum_(d.sort_order),
      edited_by: who, edited_at: new Date()
    });
    return ok ? ok_('Driver updated.') : fail_('Could not find that driver.');
  } catch (e) { return fail_(e.message); }
}

function retireDriver(token, id) {
  const who = adminName_(token); if (!who) return needAdmin_();
  const ok = updateRowById_(SHEETS.DRIVERS, 'driver_id', id, { status: 'Retired', edited_by: who, edited_at: new Date() });
  return ok ? ok_('Driver retired (hidden from pickers, history kept).') : fail_('Could not find that driver.');
}

function addDocument(token, d) {
  const who = adminName_(token); if (!who) return needAdmin_();
  try {
    if (isBlank_(d.vehicle_id)) return fail_('Pick a vehicle.');
    if (isBlank_(d.doc_type)) return fail_('Pick a document type.');
    if (isBlank_(d.expiry_date)) return fail_('Expiry date is required.');
    appendRow_(SHEETS.DOCS, {
      vehicle_id: d.vehicle_id, doc_type: d.doc_type, number: d.number,
      issue_date: parseDate_(d.issue_date), expiry_date: parseDate_(d.expiry_date)
    });
    return ok_('Document saved.');
  } catch (e) { return fail_(e.message); }
}

// ---- Admin: view lists -----------------------------------------------------

function listVehicles(token) {
  if (!adminName_(token)) return needAdmin_();
  return { ok: true, rows: getRows_(SHEETS.VEHICLES).filter(function (v) { return !isBlank_(v.vehicle_id); }).map(rowForClient_) };
}

function listDrivers(token) {
  if (!adminName_(token)) return needAdmin_();
  return { ok: true, rows: getRows_(SHEETS.DRIVERS).filter(function (d) { return !isBlank_(d.driver_id); }).map(rowForClient_) };
}

/** Active vehicles + the app URL, for printing per-bus QR codes. */
function getQrList(token) {
  if (!adminName_(token)) return needAdmin_();
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  if (!url) return fail_('Deploy the web app first (Deploy → New deployment → Web app).');
  const vehicles = getRows_(SHEETS.VEHICLES)
    .filter(function (v) { return !isBlank_(v.vehicle_id) && String(v.status).toLowerCase() !== 'retired'; })
    .map(function (v) { return { vehicle_id: v.vehicle_id, reg_no: v.reg_no || v.vehicle_id }; });
  return { ok: true, url: url, vehicles: vehicles };
}

/** Recent log entries of one type, newest first, for the Fix-entries screen. */
function listEntries(token, type, vehicleId) {
  if (!adminName_(token)) return needAdmin_();
  const name = entrySheet_(type);
  if (!name) return fail_('Unknown entry type.');
  const regOf = vehicleRegMap_();
  const rows = getRows_(name)
    .filter(function (r) { return !isBlank_(r.entry_id) && (!vehicleId || r.vehicle_id === vehicleId); })
    .map(function (r) {
      const o = rowForClient_(r);
      o.reg_no = regOf[r.vehicle_id] || r.vehicle_id;
      o.when = r.date instanceof Date ? Utilities.formatDate(r.date, TZ_(), 'dd MMM yyyy') : String(r.date || '');
      o._ts = (r.timestamp instanceof Date) ? r.timestamp.getTime() : 0;
      return o;
    })
    .sort(function (a, b) { return b._ts - a._ts; })
    .slice(0, 80);
  return { ok: true, rows: rows };
}

// ---- Admin: fix / void a log entry -----------------------------------------

function updateEntry(token, type, entryId, d) {
  const who = adminName_(token); if (!who) return needAdmin_();
  const name = entrySheet_(type);
  if (!name) return fail_('Unknown entry type.');
  try {
    // Same rule as when the entry was first made: no reading is demanded from a
    // vehicle whose odometer is marked out of action.
    const works = odoWorks_(d.vehicle_id);
    var patch;
    if (type === 'fuel') {
      const product = isBlank_(d.product) ? 'Diesel' : String(d.product).trim();
      if (CHOICES.product.indexOf(product) < 0) return fail_('Unknown product "' + product + '".');
      const propellant = isPropellant_(product);
      if (works && propellant && toNum_(d.odometer) === null) return fail_('Odometer is required.');
      patch = { date: parseDate_(d.date), vehicle_id: d.vehicle_id, odometer: toNum_(d.odometer),
        litres: toNum_(d.litres), amount: toNum_(d.amount),
        filled_to_full: propellant ? (d.filled_to_full || 'No') : 'No',
        station: d.station, paid_by: d.paid_by, driver_id: d.driver_id,
        bill_no: d.bill_no, product: product };
    } else if (type === 'maint') {
      if (works && toNum_(d.odometer) === null) return fail_('Odometer is required.');
      patch = { date: parseDate_(d.date), vehicle_id: d.vehicle_id, odometer: toNum_(d.odometer),
        category: d.category, description: d.description, parts: toNum_(d.parts) || 0,
        labour: toNum_(d.labour) || 0, vendor: d.vendor, approval_ref: d.approval_ref,
        downtime_days: toNum_(d.downtime_days) || 0 };
    } else {
      const open = toNum_(d.open_odo), close = toNum_(d.close_odo);
      if (works && (open === null || close === null)) return fail_('Opening and closing odometer are required.');
      if (open !== null && close !== null && close < open) return fail_('Closing odometer cannot be less than opening.');
      patch = { date: parseDate_(d.date), vehicle_id: d.vehicle_id, driver_id: d.driver_id,
        purpose: d.purpose, open_odo: open, close_odo: close,
        distance: (open !== null && close !== null) ? close - open : '',
        start_time: d.start_time, end_time: d.end_time };
    }
    patch.edited_by = who; patch.edited_at = new Date();
    const ok = updateRowById_(name, 'entry_id', entryId, patch);
    return ok ? ok_('Entry updated.') : fail_('Could not find that entry.');
  } catch (e) { return fail_(e.message); }
}

function voidEntry(token, type, entryId, makeVoid) {
  const who = adminName_(token); if (!who) return needAdmin_();
  const name = entrySheet_(type);
  if (!name) return fail_('Unknown entry type.');
  const ok = updateRowById_(name, 'entry_id', entryId, {
    voided: makeVoid === false ? '' : 'Yes', edited_by: who, edited_at: new Date()
  });
  if (!ok) return fail_('Could not find that entry.');
  return ok_(makeVoid === false ? 'Entry restored.' : 'Entry voided (kept for the record, left out of the figures).');
}

// ---- Small helpers ---------------------------------------------------------

function entrySheet_(type) {
  return type === 'fuel' ? SHEETS.FUEL : type === 'maint' ? SHEETS.MAINT : type === 'trip' ? SHEETS.TRIP : null;
}

function vehicleRegMap_() {
  const m = {};
  getRows_(SHEETS.VEHICLES).forEach(function (v) { m[v.vehicle_id] = v.reg_no || v.vehicle_id; });
  return m;
}

/** Turn Date cells into yyyy-MM-dd strings so the app can show/edit them. */
function rowForClient_(r) {
  const o = {};
  Object.keys(r).forEach(function (k) {
    o[k] = (r[k] instanceof Date) ? Utilities.formatDate(r[k], TZ_(), 'yyyy-MM-dd') : r[k];
  });
  return o;
}

function ok_(msg)      { return { ok: true,  message: msg }; }
function fail_(msg)    { return { ok: false, error: msg }; }
function skipped_(msg) { return { ok: true,  skipped: true, message: msg }; }
function needAdmin_()  { return { ok: false, error: 'Your admin session has locked. Please unlock again.', relogin: true }; }
