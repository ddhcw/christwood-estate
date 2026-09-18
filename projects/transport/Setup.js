/**
 * Setup.gs — builds the whole workbook in one click.
 *
 * This file is the single source of truth for every tab and its columns.
 * Run setupWorkbook() once after pasting the code in (or use the Fleet menu).
 * It is safe to run again — it only adds what is missing and never deletes your data.
 */

// ---- Tab names (used everywhere) -------------------------------------------
const SHEETS = {
  VEHICLES: 'Vehicle_Master',
  DRIVERS:  'Driver_Master',
  STAFF:    'Staff',
  FUEL:     'Fuel_Log',
  MAINT:    'Maintenance_Log',
  TRIP:     'Trip_Log',
  DOCS:     'Document_Register',
  ODO:      'Odometer_Events',
  ROSTER:   'Attendance_Roster',
  ATTEND:   'Attendance_Log',
  FUELRPT:  'Fuel_Reports',
  SUMMARY:  'Monthly_Summary',
  DASH:     'Dashboard',
  SETTINGS: 'Settings'
};

// ---- Columns for each tab (header row, in order) ---------------------------
// NOTE: when adding fields to a tab that already holds live data, ALWAYS append
// at the END. The code maps headers to columns by position, so existing rows
// must keep their original column order. New trailing columns are filled in by
// migrateData_() the next time setupWorkbook() runs.
const HEADERS = {
  // off_road_* and odo_* are the vehicle's CURRENT state, written only by code
  // (Data.gs). The history behind them lives in Odometer_Events and the
  // Maintenance_Log — those are what the analytics read.
  [SHEETS.VEHICLES]: ['vehicle_id', 'reg_no', 'make_model', 'type', 'seating',
                      'year', 'in_service_date', 'status', 'gps_device_id', 'access_card_id',
                      'edited_by', 'edited_at',
                      'off_road_since', 'off_road_entry_id', 'odo_working', 'odo_broken_since',
                      'route_no'],
  [SHEETS.DRIVERS]:  ['driver_id', 'name', 'licence_no', 'licence_expiry', 'phone', 'assigned_vehicle',
                      'status', 'edited_by', 'edited_at', 'sort_order'],
  [SHEETS.STAFF]:    ['name', 'role', 'active'],
  // product tells diesel from AdBlue and the like: only fuel counts toward km/L.
  // reported_in stamps which Fuel Process report already carried this row, so a
  // late bill is swept into the next report instead of being missed or repeated.
  [SHEETS.FUEL]:     ['timestamp', 'date', 'vehicle_id', 'odometer', 'litres', 'amount',
                      'filled_to_full', 'station', 'paid_by', 'driver_id', 'entered_by',
                      'entry_id', 'voided', 'edited_by', 'edited_at',
                      'bill_no', 'product', 'reported_in'],
  [SHEETS.MAINT]:    ['timestamp', 'date', 'vehicle_id', 'odometer', 'category', 'description',
                      'parts', 'labour', 'vendor', 'approval_ref', 'downtime_days', 'entered_by',
                      'entry_id', 'voided', 'edited_by', 'edited_at'],
  [SHEETS.TRIP]:     ['timestamp', 'date', 'vehicle_id', 'driver_id', 'purpose',
                      'open_odo', 'close_odo', 'distance', 'start_time', 'end_time', 'entered_by',
                      'entry_id', 'voided', 'edited_by', 'edited_at'],
  [SHEETS.DOCS]:     ['vehicle_id', 'doc_type', 'number', 'issue_date', 'expiry_date'],
  // Append-only record of a vehicle's odometer going out of action and coming back.
  // "Working" rows carry the reading the repaired/replaced meter showed on the day.
  [SHEETS.ODO]:      ['timestamp', 'date', 'vehicle_id', 'event', 'reading', 'was_reset',
                      'note', 'entered_by'],
  // Extra attendance rows that are not a driver in Driver_Master — the Standby
  // slots and the posts nobody is named against yet. Kept apart from
  // Driver_Master so they never pollute the fuel/trip driver pickers.
  [SHEETS.ROSTER]:   ['roster_id', 'label', 'route_no', 'sort_order', 'status',
                      'edited_by', 'edited_at'],
  // One row per person per day. member_id is a driver_id (D001) or a roster_id
  // (X001); day_key makes the write an upsert so re-marking a day corrects it
  // instead of duplicating it. route_no/name are snapshots so a past month
  // reprints as it was, not as the roster looks today.
  [SHEETS.ATTEND]:   ['timestamp', 'date', 'day_key', 'member_id', 'name', 'route_no',
                      'code', 'note', 'entered_by', 'edited_by', 'edited_at'],
  // Register of every Fuel Process report generated, so rows can be stamped
  // with the report that carried them.
  [SHEETS.FUELRPT]:  ['report_id', 'generated_at', 'from_date', 'to_date', 'rows',
                      'total_amount', 'generated_by', 'file_url'],
  [SHEETS.SUMMARY]:  ['month', 'vehicle_id', 'reg_no', 'km', 'fuel_cost', 'fuel_cost_per_km',
                      'efficiency_kmpl', 'maint_cost', 'maint_cost_per_km', 'total_cost_per_km',
                      'cumulative_maint', 'downtime_days', 'notes'],
  [SHEETS.SETTINGS]: ['setting', 'value', 'notes']
};

// ---- Pastel palette --------------------------------------------------------
const PALETTE = {
  lavender: '#E8E1F5', lavenderText: '#4A3F6B',
  mint:     '#DDF3E4', peach: '#FCE8DA', sky: '#DDEBF7',
  band:     '#F7F4FB', headerText: '#3F3A52',
  flagRed:  '#FAD9D9', okGreen: '#DDF3E4', warnAmber: '#FCF0D6'
};

// ---- Dropdown choices ------------------------------------------------------
const CHOICES = {
  type:          ['Bus', 'Van', 'Car'],
  status:        ['Active', 'Standby', 'Under maintenance', 'Retired'],
  driver_status: ['Active', 'Retired'],
  yesno:         ['Yes', 'No'],
  paid_by:       ['Card', 'Cash', 'Reimbursement'],
  category:      ['Scheduled', 'Breakdown', 'Accident'],
  purpose:       ['Routine', 'Sports', 'Field', 'Staff'],
  doc_type:      ['Insurance', 'FC', 'Permit', 'PUC'],
  active:        ['Yes', 'No'],
  odo_event:     ['Broken', 'Working'],
  // Only Diesel and Petrol move a vehicle, so only they count toward km/L.
  product:       ['Diesel', 'Petrol', 'AdBlue', 'Other'],
  attendance:    ['P', 'L', 'H', 'O']
};

/** Products that actually propel the vehicle — everything else is a consumable. */
const FUEL_PRODUCTS = ['Diesel', 'Petrol'];

/** What each attendance letter means, for the app and the printed legend. */
const ATTENDANCE_LABELS = {
  P: 'Present', L: 'Leave', H: 'Half day', O: 'Holiday'
};

/** The one status that means "off road" — spelt once, compared everywhere. */
const STATUS_OFF_ROAD = 'Under maintenance';

// ---- Default settings (seeded only if Settings is empty) -------------------
const DEFAULT_SETTINGS = [
  ['app_title', 'School Transport — Fleet Tracker', 'Title shown at the top of the app'],
  ['currency_symbol', '₹', 'Shown next to money amounts'],
  ['distance_unit', 'km', 'Distance unit'],
  ['volume_unit', 'L', 'Fuel volume unit'],
  ['alert_email', '', 'Email address that gets document-expiry alerts (leave blank to use the owner)'],
  ['doc_expiry_warning_days', '30', 'Warn this many days before a document expires'],
  ['replace_window_months', '3', 'Trailing window length for the replace signal (months)'],
  ['replace_maint_costkm_rise_pct', '20', 'Flag if maintenance cost/km rose at least this % vs the previous window'],
  ['replace_efficiency_drop_pct', '10', 'Flag if efficiency fell at least this % vs the previous window'],
  ['replace_downtime_rise_days', '2', 'Flag if downtime rose at least this many days vs the previous window'],
  ['replace_require_all_three', 'Yes', 'Yes = all three conditions must be true. No = any two are enough.'],
  ['low_efficiency_kmpl', '', 'Optional: always warn if a vehicle drops below this km/L (leave blank to ignore)'],
  ['fuel_price_per_litre', '', 'Current fuel price per litre. Auto-fills litres from the amount and flags odd fuel entries. Blank = off'],
  ['fuel_price_tolerance_pct', '25', 'Flag a fuel entry if its price per litre is more than this % away from fuel_price_per_litre'],
  // service_interval_km / service_warn_km are no longer read by the service-due
  // check (RFC-0002 replaced km with a fleet-wide date) but stay in the sheet —
  // deleting a Settings row would destroy whatever value is already entered.
  ['service_interval_km', '10000', 'A scheduled service is due every this many km'],
  ['service_warn_km', '500', 'Start warning when a vehicle is within this many km of a due service'],
  ['service_due_date', '', 'Fleet-wide date the next service is due (yyyy-MM-dd). Leave blank to turn off the service-due check'],
  ['service_interval_months', '12', 'After service_due_date passes, a vehicle counts as serviced if it has a Scheduled maintenance record within this many months before that date'],
  ['silent_vehicle_days', '21', 'Flag an active vehicle with no fuel entry for this many days'],
  ['odo_jump_km', '3000', 'Flag when consecutive odometer readings jump by more than this many km'],
  ['off_road_reminder_days', '7', 'Remind us if a vehicle has been marked "Under maintenance" this long — it is usually someone forgetting to mark it back on road'],
  ['odo_broken_reminder_days', '14', 'Remind us if a vehicle\'s odometer has been marked not working this long. Every day it stays broken is a month with no cost/km figure'],
  ['licence_warning_days', '30', 'Warn this many days before a driver licence expires'],
  ['weekly_digest', 'Yes', 'Email a Monday-morning summary of the week'],
  ['monthly_report', 'Yes', 'Email last month\'s summary on the 1st of each month'],
  ['backup_keep', '30', 'How many nightly backup copies to keep in Drive'],
  ['school_name', 'Christwood School', 'Printed at the top of the Fuel Process report'],
  ['fuel_report_title', 'Fuel Process', 'Heading on the fuel report, before the date range'],
  ['fuel_report_rows_per_page', '23', 'Rows on each page of the fuel report before it breaks'],
  ['fuel_report_station', 'LAKSHMI AGENCY', 'Filling station to suggest on new fuel entries (blank = off)'],
  ['report_prepared_by', 'Mr. Lakshmanan Kumar', 'Left signature on the fuel report'],
  ['report_prepared_title', 'Transport in charge', 'Title under the left signature'],
  ['report_verified_by', 'Ms. Sharon Paul', 'Middle signature on the fuel report'],
  ['report_verified_title', 'HR – Head', 'Title under the middle signature'],
  ['report_approved_by', 'Dr. S. Alfred Devaprasad', 'Right signature on the fuel report'],
  ['report_approved_title', 'CEO & Correspondent', 'Title under the right signature'],
  ['attendance_week_off', 'Sunday', 'Day of the week left blank on the attendance sheet (blank = none)'],
  ['attendance_reminder', 'Yes', 'Remind us in the morning email if yesterday was never marked']
];

/**
 * MAIN ENTRY POINT — run this once to build everything.
 */
function setupWorkbook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 0) Pin the spreadsheet's timezone to the script's. If the two disagree, a
  //    date cell can render a day out — which would land an attendance mark in
  //    the wrong column and put a fuel bill in the wrong month.
  try {
    const tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
    if (ss.getSpreadsheetTimeZone() !== tz) ss.setSpreadsheetTimeZone(tz);
  } catch (e) { /* not fatal — the script timezone still governs formatting */ }

  // 1) Create every tab + header row.
  Object.keys(HEADERS).forEach(function (name) {
    const sh = getOrCreateSheet_(ss, name);
    writeHeader_(sh, HEADERS[name]);
  });
  getOrCreateSheet_(ss, SHEETS.DASH); // Dashboard is drawn by Analytics.gs

  // 2) Seed Settings if empty.
  seedSettings_(ss);

  // 3) Dropdowns + guard rails.
  applyValidations_(ss);

  // 3b) Fill in new columns for any data already in the sheet (safe to repeat).
  migrateData_(ss);

  // 4) Tidy the masters/logs visually.
  // Attendance_Log is deliberately absent: it is the tab that grows fastest, and
  // autoResizeColumn over tens of thousands of rows on every setup run would
  // eventually time this out. Its header is styled by writeHeader_ and left alone.
  [SHEETS.VEHICLES, SHEETS.DRIVERS, SHEETS.STAFF, SHEETS.FUEL, SHEETS.MAINT,
   SHEETS.TRIP, SHEETS.DOCS, SHEETS.ODO, SHEETS.ROSTER, SHEETS.FUELRPT,
   SHEETS.SUMMARY, SHEETS.SETTINGS].forEach(function (name) {
    prettifySheet_(ss.getSheetByName(name));
  });

  // 5) Remove the default blank "Sheet1" if it is still empty.
  removeEmptyDefaultSheet_(ss);

  // 6) Order the tabs sensibly.
  reorderTabs_(ss);

  SpreadsheetApp.getActive().toast('Workbook ready. Now Deploy → Web app to get your link.', 'Fleet setup complete', 8);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeHeader_(sh, headers) {
  // A tab that was trimmed down, or that predates newer columns, may be too
  // narrow to hold the header row. Widen it before writing.
  const short = headers.length - sh.getMaxColumns();
  if (short > 0) sh.insertColumnsAfter(sh.getMaxColumns(), short);
  const range = sh.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold').setFontColor(PALETTE.headerText)
       .setBackground(PALETTE.lavender).setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 30);
}

function prettifySheet_(sh) {
  if (!sh) return;
  const lastCol = Math.max(1, sh.getLastColumn());
  // Auto-size columns for readability.
  for (var c = 1; c <= lastCol; c++) sh.autoResizeColumn(c);
  // Gentle alternating bands (skip if one already exists).
  try {
    if (sh.getBandings().length === 0 && sh.getMaxRows() > 1) {
      sh.getRange(1, 1, sh.getMaxRows(), lastCol)
        .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
    }
  } catch (e) { /* banding is cosmetic — never block setup */ }
}

function seedSettings_(ss) {
  // Adds any settings that are missing; never changes a value the user already has.
  const sh = ss.getSheetByName(SHEETS.SETTINGS);
  const have = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (String(r[0]).trim() !== '') have[r[0]] = true;
    });
  }
  const missing = DEFAULT_SETTINGS.filter(function (s) { return !have[s[0]]; });
  if (!missing.length) return;
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, missing.length, 3).setValues(missing);
  sh.getRange(start, 1, missing.length, 1).setFontWeight('bold');
}

function applyValidations_(ss) {
  const N = 2000; // rows of data we pre-arm with dropdowns

  // Simple list dropdowns.
  listRule_(ss, SHEETS.VEHICLES, 'type',  CHOICES.type, N);
  listRule_(ss, SHEETS.VEHICLES, 'status', CHOICES.status, N);
  listRule_(ss, SHEETS.VEHICLES, 'odo_working', CHOICES.yesno, N);
  listRule_(ss, SHEETS.ODO, 'event', CHOICES.odo_event, N);
  listRule_(ss, SHEETS.DRIVERS, 'status', CHOICES.driver_status, N);
  listRule_(ss, SHEETS.STAFF, 'active', CHOICES.active, N);
  listRule_(ss, SHEETS.FUEL, 'filled_to_full', CHOICES.yesno, N);
  listRule_(ss, SHEETS.FUEL, 'paid_by', CHOICES.paid_by, N);
  listRule_(ss, SHEETS.FUEL, 'product', CHOICES.product, N);
  listRule_(ss, SHEETS.ROSTER, 'status', CHOICES.driver_status, N);
  listRule_(ss, SHEETS.MAINT, 'category', CHOICES.category, N);
  listRule_(ss, SHEETS.TRIP, 'purpose', CHOICES.purpose, N);
  listRule_(ss, SHEETS.DOCS, 'doc_type', CHOICES.doc_type, N);

  // vehicle_id / driver_id must exist in the masters.
  rangeRule_(ss, SHEETS.FUEL,  'vehicle_id', SHEETS.VEHICLES, 'vehicle_id', N);
  rangeRule_(ss, SHEETS.MAINT, 'vehicle_id', SHEETS.VEHICLES, 'vehicle_id', N);
  rangeRule_(ss, SHEETS.TRIP,  'vehicle_id', SHEETS.VEHICLES, 'vehicle_id', N);
  rangeRule_(ss, SHEETS.DOCS,  'vehicle_id', SHEETS.VEHICLES, 'vehicle_id', N);
  rangeRule_(ss, SHEETS.ODO,   'vehicle_id', SHEETS.VEHICLES, 'vehicle_id', N);
  rangeRule_(ss, SHEETS.FUEL,  'driver_id',  SHEETS.DRIVERS,  'driver_id',  N);
  rangeRule_(ss, SHEETS.TRIP,  'driver_id',  SHEETS.DRIVERS,  'driver_id',  N);
}

function colIndex_(sheetName, colName) {
  return HEADERS[sheetName].indexOf(colName) + 1; // 1-based
}

/**
 * Fill the new columns for rows that already exist (live data).
 * - gives every fuel/maintenance/trip row a unique entry_id (so it can be edited)
 * - defaults any driver without a status to "Active"
 * - assumes every existing vehicle's odometer works (odo_working = Yes)
 * Safe to run any number of times; it only touches blank cells.
 */
function migrateData_(ss) {
  [SHEETS.FUEL, SHEETS.MAINT, SHEETS.TRIP].forEach(function (name) {
    backfillBlank_(ss, name, 'entry_id', 'vehicle_id', function () { return newEntryId_(); });
  });
  backfillBlank_(ss, SHEETS.DRIVERS, 'status', 'driver_id', function () { return 'Active'; });
  backfillBlank_(ss, SHEETS.VEHICLES, 'odo_working', 'vehicle_id', function () { return 'Yes'; });
  // Fuel rows written before the product column existed were all diesel.
  backfillBlank_(ss, SHEETS.FUEL, 'product', 'vehicle_id', function () { return 'Diesel'; });
  // Give drivers a starting order in their current sheet order, in tens so a new
  // driver can be slotted between two without renumbering the rest.
  var n = 0;
  backfillBlank_(ss, SHEETS.DRIVERS, 'sort_order', 'driver_id', function () { n += 10; return n; });
}

/** For a tab, fill `fillCol` with valueFn() on rows that have data (keyCol set) but a blank fillCol. */
function backfillBlank_(ss, name, fillCol, keyCol, valueFn) {
  const sh = ss.getSheetByName(name);
  if (!sh) return;
  const last = sh.getLastRow();
  if (last < 2) return;
  const fIdx = colIndex_(name, fillCol), kIdx = colIndex_(name, keyCol);
  if (fIdx < 1 || kIdx < 1) return;
  const fillVals = sh.getRange(2, fIdx, last - 1, 1).getValues();
  const keyVals  = sh.getRange(2, kIdx, last - 1, 1).getValues();
  var changed = false;
  for (var i = 0; i < fillVals.length; i++) {
    const hasData = String(keyVals[i][0]).trim() !== '';
    const isBlank = String(fillVals[i][0]).trim() === '';
    if (hasData && isBlank) { fillVals[i][0] = valueFn(); changed = true; }
  }
  if (changed) sh.getRange(2, fIdx, fillVals.length, 1).setValues(fillVals);
}

function listRule_(ss, sheetName, colName, values, nRows) {
  const sh = ss.getSheetByName(sheetName);
  const col = colIndex_(sheetName, colName);
  if (col < 1) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true).setAllowInvalid(false).build();
  sh.getRange(2, col, nRows, 1).setDataValidation(rule);
}

function rangeRule_(ss, sheetName, colName, masterSheet, masterCol, nRows) {
  const sh = ss.getSheetByName(sheetName);
  const col = colIndex_(sheetName, colName);
  const mCol = colIndex_(masterSheet, masterCol);
  if (col < 1 || mCol < 1) return;
  const source = ss.getSheetByName(masterSheet).getRange(2, mCol, 5000, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(source, true).setAllowInvalid(true) // allow but warn
    .build();
  sh.getRange(2, col, nRows, 1).setDataValidation(rule);
}

function removeEmptyDefaultSheet_(ss) {
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && def.getLastColumn() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(def);
  }
}

function reorderTabs_(ss) {
  const order = [SHEETS.DASH, SHEETS.FUEL, SHEETS.MAINT, SHEETS.TRIP,
                 SHEETS.ATTEND, SHEETS.VEHICLES, SHEETS.DRIVERS, SHEETS.ROSTER,
                 SHEETS.STAFF, SHEETS.DOCS, SHEETS.ODO, SHEETS.FUELRPT,
                 SHEETS.SUMMARY, SHEETS.SETTINGS];
  order.forEach(function (name, i) {
    const sh = ss.getSheetByName(name);
    if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); }
  });
  ss.setActiveSheet(ss.getSheetByName(SHEETS.DASH));
}
