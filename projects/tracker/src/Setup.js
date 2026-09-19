/**
 * Christwood ICT — Projects Tracker
 * Setup.js — idempotent, code-owned construction of every tab.
 *
 * Re-runnable at any time. It adds what is missing and repairs the visual
 * layer; it never rewrites a header that already exists and never touches a
 * cell a human has typed into. Adding a column to Schema.js and re-running
 * Setup is the supported way to evolve the schema.
 */

var BRAND = {
  HEADER_BG:   '#1C4E9D',
  HEADER_TEXT: '#FFFFFF',
  PRIMARY:     '#1C4E9D',
  PRIMARY_TINT:'#E6F0FA',
  BAND_A:      '#FFFFFF',
  BAND_B:      '#F5F8FC',
  LOCKED_BG:   '#F2F4F6',   // master-owned columns inside a project's own tab
  NOTE_BG:     '#FFF8E1'
};

var STATUS_COLOURS = {
  'New':          { bg: '#FDF0D5', fg: '#9A6400' },   // pending  = amber
  'Accepted':     { bg: '#E6F0FA', fg: '#1C4E9D' },
  'In progress':  { bg: '#CFE0F5', fg: '#153C79' },
  'Done':         { bg: '#E3F2E4', fg: '#2E7D32' },   // done     = green
  "Won't do":     { bg: '#EEF0F2', fg: '#5F6469' },   // stale    = grey
  'Not an issue': { bg: '#EEF0F2', fg: '#5F6469' }
};

/** Rows validation and formatting are applied down to, so a freshly typed
 *  row at the bottom already has its dropdowns. Staff must never have to
 *  copy formatting down — that is exactly the load we are removing. */
var VALIDATION_ROWS = 1000;

// ---------- Entry point ----------

/**
 * Builds or repairs every tab on the master tracker.
 * Safe to run on a live sheet, mid-term, with people in it.
 */
function setupSheets() {
  return guarded_('setupSheets', function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);

    var report = [];

    var tracker = resolveTrackerSheet_(ss);
    report.push(ensureTrackerColumns_(tracker));

    report.push(ensureTab_(ss, CONFIG.TAB.STAFF,       staffColumns_()));
    report.push(ensureTab_(ss, CONFIG.TAB.CONFIG,      configColumns_()));
    report.push(ensureTab_(ss, CONFIG.TAB.WEBHOOKS,    webhookColumns_()));
    report.push(ensureTab_(ss, CONFIG.TAB.SUGGESTIONS, masterSuggestionColumns_()));
    report.push(ensureTab_(ss, CONFIG.TAB.ARCHIVE,     masterSuggestionColumns_()));
    report.push(ensureTab_(ss, CONFIG.TAB.AUDIT,       auditColumns_()));

    seedConfigTab_(ss);
    seedWebhooksTab_(ss);
    seedStaffFromTracker_(ss, tracker);

    // Formatting runs last: the tracker's Owner dropdown and the master tab's
    // Project/Assignee dropdowns validate against live ranges on the Staff and
    // tracker tabs, so those tabs have to exist and be populated first.
    formatTrackerSheet_(tracker);
    formatSuggestionsSheet_(ss.getSheetByName(CONFIG.TAB.SUGGESTIONS), true);
    formatSuggestionsSheet_(ss.getSheetByName(CONFIG.TAB.ARCHIVE), true);
    formatSimpleTab_(ss.getSheetByName(CONFIG.TAB.STAFF),    staffColumns_());
    formatSimpleTab_(ss.getSheetByName(CONFIG.TAB.CONFIG),   configColumns_());
    formatSimpleTab_(ss.getSheetByName(CONFIG.TAB.WEBHOOKS), webhookColumns_());
    formatSimpleTab_(ss.getSheetByName(CONFIG.TAB.AUDIT),    auditColumns_());

    report.push(applyProtection_(ss));
    clearSettingsCache_();
    clearBootstrapCache_();

    var msg = report.filter(String).join('\n') || 'Everything was already in place.';
    audit_('Setup', '', '', 'setupSheets run', msg);
    return msg;
  });
}

// ---------- Tracker tab ----------

/**
 * Finds the main tracker tab without trusting a hardcoded name: the tab called
 * Sheet1 if it has a Name header, otherwise the first tab that does. Renaming
 * the tab must not break the system.
 */
function resolveTrackerSheet_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var reserved = {};
  Object.keys(CONFIG.TAB).forEach(function (k) {
    if (k !== 'TRACKER') reserved[CONFIG.TAB[k]] = true;
  });

  var named = ss.getSheetByName(CONFIG.TAB.TRACKER);
  if (named && hasHeader_(named, 'Name')) return named;

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (reserved[sheets[i].getName()]) continue;
    if (hasHeader_(sheets[i], 'Name')) return sheets[i];
  }
  return named || sheets[0];
}

function hasHeader_(sheet, headerName) {
  if (!sheet || sheet.getLastColumn() < 1) return false;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var want = normalizeKey_(headerName);
  return headers.some(function (h) { return normalizeKey_(h) === want; });
}

/**
 * Adds Owner and Contributors if absent. `Maintained By` is left in place and
 * renamed to Owner only when Owner does not already exist — the migration
 * (Migrate.js) is what actually cleans its contents.
 */
function ensureTrackerColumns_(sheet) {
  var t = readTable_(sheet);
  var added = [];

  var hasMaintainedBy = t.idx[normalizeKey_('Maintained By')] !== undefined;
  var hasOwner        = t.idx[normalizeKey_('Owner')] !== undefined;

  if (hasMaintainedBy && !hasOwner) {
    sheet.getRange(1, t.idx[normalizeKey_('Maintained By')] + 1).setValue('Owner');
    added.push('Renamed "Maintained By" → "Owner" (contents untouched — run the migration to clean them).');
    t = readTable_(sheet);
  }

  // Driven by Schema.js, not a hardcoded pair. CLAUDE.md promises that adding a
  // column there plus a Setup re-run is the supported way to evolve the schema;
  // naming two columns here quietly made that false for the tracker tab alone.
  columnNames_(trackerColumns_()).forEach(function (name) {
    if (t.idx[normalizeKey_(name)] === undefined) {
      // Capture the position BEFORE inserting. getLastColumn() counts columns
      // that have CONTENT, and a freshly inserted column is empty — so calling
      // it again here returns the same N as before, and the new header lands on
      // top of the existing last header instead of beside it. That destroyed
      // the "Contributors" header twice (8 and 18 Sep), each time leaving its
      // values in place under the wrong name.
      var at = Math.max(sheet.getLastColumn(), 1);
      sheet.insertColumnAfter(at);
      sheet.getRange(1, at + 1).setValue(name);
      added.push('Added tracker column "' + name + '".');
      t = readTable_(sheet);
    }
  });

  return added.join('\n');
}

// ---------- Generic tab construction ----------

/**
 * Creates the tab if missing; appends any canonical column it does not yet
 * have. Existing columns keep their position — everything looks columns up by
 * header name, so order is cosmetic and reordering would only risk data.
 */
function ensureTab_(ss, tabName, cols) {
  var names = columnNames_(cols);
  var sheet = ss.getSheetByName(tabName);
  var notes = [];

  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, names.length).setValues([names]);
    if (sheet.getMaxColumns() > names.length) {
      sheet.deleteColumns(names.length + 1, sheet.getMaxColumns() - names.length);
    }
    notes.push('Created tab "' + tabName + '".');
  } else {
    var t = readTable_(sheet);
    var missing = names.filter(function (n) { return t.idx[normalizeKey_(n)] === undefined; });
    if (missing.length) {
      var start = Math.max(sheet.getLastColumn(), 1) + 1;
      if (sheet.getMaxColumns() < start + missing.length - 1) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), start + missing.length - 1 - sheet.getMaxColumns());
      }
      sheet.getRange(1, start, 1, missing.length).setValues([missing]);
      notes.push('Added to "' + tabName + '": ' + missing.join(', ') + '.');
    }
  }

  // Header notes explain each column in the sheet itself — the cheapest
  // documentation there is, and it travels with the file.
  var t2 = readTable_(sheet);
  cols.forEach(function (c) {
    if (!c.note) return;
    var n = colNum_(t2, c.name);
    if (n) sheet.getRange(1, n).setNote(c.note);
  });

  return notes.join('\n');
}

// ---------- Seeding ----------

function seedConfigTab_(ss) {
  var sheet = ss.getSheetByName(CONFIG.TAB.CONFIG);
  var t = readTable_(sheet);
  var existing = {};
  t.rows.forEach(function (r) {
    var k = str_(t, r, 'Setting');
    if (k) existing[k] = true;
  });

  var toAdd = CONFIG_DEFAULTS
    .filter(function (d) { return !existing[d[0]]; })
    .map(function (d) { return [d[0], d[1], d[3]]; });

  if (toAdd.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 3).setValues(toAdd);
  }
}

/**
 * One Ops Alerts space, several webhooks pointing into it — the webhook's own
 * name is what appears as the sender, so a failure announces which tracker it
 * came from without anyone reading the message body.
 * Digest webhooks point at each team's own space instead.
 */
function webhookCatalogue_() {
  return [
    ['OPS_SYNC',       'Ops',    'Nightly sync failures, dead-trigger heartbeat, and anything that throws in this tracker. Name this webhook "Projects Tracker".'],
    ['OPS_ACADEMIC',   'Ops',    'Failures on Academic Trackers projects. Name it "Academic Trackers" so the sender line tells you where.'],
    ['OPS_ADMIN',      'Ops',    'Failures on Admin Trackers projects. Name it "Admin Trackers".'],
    ['OPS_DATABASES',  'Ops',    'Failures on Databases projects. Name it "Databases".'],
    ['OPS_TECH',       'Ops',    'Failures on Tech Group / infrastructure projects. Name it "Tech Group".'],
    ['DIGEST_ACADEMIC','Digest', 'Weekly open-items card into the Academic Trackers Chat space.'],
    ['DIGEST_ADMIN',   'Digest', 'Weekly open-items card into the Admin Trackers Chat space.'],
    ['DIGEST_TRANSPORT','Digest','Weekly open-items card into the Transport Chat space.'],
    ['DIGEST_TECH',    'Digest', 'Weekly open-items card into the Tech Group Chat space.']
  ];
}

function seedWebhooksTab_(ss) {
  var sheet = ss.getSheetByName(CONFIG.TAB.WEBHOOKS);
  var t = readTable_(sheet);
  var existing = {};
  t.rows.forEach(function (r) {
    var k = str_(t, r, 'Key');
    if (k) existing[k] = true;
  });

  var toAdd = webhookCatalogue_()
    .filter(function (w) { return !existing[w[0]]; })
    .map(function (w) { return [w[0], w[1], w[2], '']; });

  if (toAdd.length) sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 4).setValues(toAdd);
  refreshWebhookStatus();
}

/** Rewrites the Configured column from Script Properties. No URL ever lands in the sheet.
 *  Public (no trailing underscore) because the menu calls it directly. */
function refreshWebhookStatus() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TAB.WEBHOOKS);
  if (!sheet || sheet.getLastRow() < 2) return;
  var t = readTable_(sheet);
  var col = colNum_(t, 'Configured');
  if (!col) return;

  var out = t.rows.map(function (r) {
    var key = str_(t, r, 'Key');
    if (!key) return [''];
    return [getWebhook_(key) ? '✅ Set' : '— Not set'];
  });
  if (out.length) sheet.getRange(2, col, out.length, 1).setValues(out);
}

/**
 * Pre-fills the Staff tab from names already in the tracker, so nobody has to
 * type a staff list from scratch. Emails are left blank for Dan to fill.
 */
function seedStaffFromTracker_(ss, tracker) {
  var staffSheet = ss.getSheetByName(CONFIG.TAB.STAFF);
  var st = readTable_(staffSheet);

  var known = {};
  st.rows.forEach(function (r) {
    var n = str_(st, r, 'Name');
    if (n) known[n.toLowerCase()] = true;
    splitNames_(str_(st, r, 'Aliases')).forEach(function (a) { known[a.toLowerCase()] = true; });
  });

  var t = readTable_(tracker);
  var found = [];
  t.rows.forEach(function (r) {
    if (isBlankRow_(r)) return;
    var raw = str_(t, r, 'Owner') || str_(t, r, 'Maintained By');
    if (isOwnerPlaceholder_(raw) || isEmptyToken_(raw)) return;
    splitNames_(raw).concat(splitNames_(str_(t, r, 'Contributors'))).forEach(function (n) {
      if (!known[n.toLowerCase()]) { known[n.toLowerCase()] = true; found.push(n); }
    });
  });

  if (found.length) {
    var rows = uniq_(found).map(function (n) { return [n, '', '', '', true]; });
    staffSheet.getRange(staffSheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  }
}

// ---------- Visual layer ----------

function headerStyle_(sheet, colCount) {
  sheet.getRange(1, 1, 1, colCount)
    .setBackground(BRAND.HEADER_BG)
    .setFontColor(BRAND.HEADER_TEXT)
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left')
    .setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
}

function applyWidths_(sheet, table, cols) {
  cols.forEach(function (c) {
    var n = colNum_(table, c.name);
    if (n && c.width) sheet.setColumnWidth(n, c.width);
  });
}

function formatSimpleTab_(sheet, cols) {
  if (!sheet) return;
  var t = readTable_(sheet);
  headerStyle_(sheet, Math.max(sheet.getLastColumn(), columnNames_(cols).length));
  applyWidths_(sheet, t, cols);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
      .setFontSize(10).setVerticalAlignment('top').setWrap(true);
  }
  sheet.setHiddenGridlines(true);
}

/**
 * Formats a Suggestions-shaped tab — master, Archive, or one living inside a
 * project file. `isMaster` adds the Project column's live dropdown.
 */
function formatSuggestionsSheet_(sheet, isMaster) {
  if (!sheet) return;
  var ss = sheet.getParent();
  var cols = isMaster ? masterSuggestionColumns_() : suggestionColumns_();
  var t = readTable_(sheet);

  headerStyle_(sheet, Math.max(sheet.getLastColumn(), columnNames_(cols).length));
  applyWidths_(sheet, t, cols);
  sheet.setHiddenGridlines(true);

  if (sheet.getMaxRows() < VALIDATION_ROWS) {
    sheet.insertRowsAfter(sheet.getMaxRows(), VALIDATION_ROWS - sheet.getMaxRows());
  }
  var bodyRows = VALIDATION_ROWS - 1;

  sheet.getRange(2, 1, bodyRows, Math.max(sheet.getLastColumn(), 1))
    .setFontSize(10).setVerticalAlignment('top').setWrap(true);

  // --- Dropdowns ---
  var statusCol = colNum_(t, 'Status');
  if (statusCol) {
    sheet.getRange(2, statusCol, bodyRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.STATUS_ALL, true)
        .setAllowInvalid(false).build());
  }

  var typeCol = colNum_(t, 'Type');
  if (typeCol) {
    sheet.getRange(2, typeCol, bodyRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.TYPES, true)
        .setAllowInvalid(false).build());
  }

  if (isMaster) {
    // Project and Assignee validate against live ranges, so adding project 22
    // or a new staff member needs no code change and no re-run of Setup (C3).
    var tracker = resolveTrackerSheet_(ss);
    var tt = readTable_(tracker);
    var nameCol = colNum_(tt, 'Name');
    var projCol = colNum_(t, 'Project');
    if (nameCol && projCol) {
      sheet.getRange(2, projCol, bodyRows, 1).setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInRange(tracker.getRange(2, nameCol, Math.max(tracker.getMaxRows() - 1, 1), 1), true)
          .setAllowInvalid(true)   // allow a typo rather than block capture
          .build());
    }

    var staff = ss.getSheetByName(CONFIG.TAB.STAFF);
    var assigneeCol = colNum_(t, 'Assignee');
    if (staff && assigneeCol) {
      sheet.getRange(2, assigneeCol, bodyRows, 1).setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInRange(staff.getRange(2, 1, Math.max(staff.getMaxRows() - 1, 1), 1), true)
          .setAllowInvalid(true)
          .build());
    }
  }

  // --- Conditional formatting: status colours + blocked + stale ---
  var rules = [];
  if (statusCol) {
    var statusRange = sheet.getRange(2, statusCol, bodyRows, 1);
    CONFIG.STATUS_ALL.forEach(function (s) {
      var c = STATUS_COLOURS[s];
      if (!c) return;
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(s).setBackground(c.bg).setFontColor(c.fg)
        .setRanges([statusRange]).build());
    });
  }

  var waitCol = colNum_(t, 'Waiting on');
  if (waitCol) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenCellNotEmpty()
      .setBackground('#FBEAE9').setFontColor('#C0271F')
      .setRanges([sheet.getRange(2, waitCol, bodyRows, 1)]).build());
  }

  // A passed deadline on an item that is still open. Longhand rather than an
  // array literal — array separators are locale-dependent.
  var dueCol = colNum_(t, 'Needed by');
  if (dueCol) {
    var dueRange = sheet.getRange(2, dueCol, bodyRows, 1);
    dueRange.setNumberFormat('yyyy-mm-dd');
    if (statusCol) {
      var sL = colLetter_(statusCol), dL = colLetter_(dueCol);
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(
          '=AND($' + dL + '2<>"", $' + dL + '2<TODAY(), $' + sL + '2<>"Done", ' +
          '$' + sL + '2<>"Won\'t do", $' + sL + '2<>"Not an issue")')
        .setBackground('#FBEAE9').setFontColor('#C0271F')
        .setRanges([dueRange]).build());
      // Within a week: amber, the estate's "pending" colour.
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(
          '=AND($' + dL + '2<>"", $' + dL + '2>=TODAY(), $' + dL + '2<=TODAY()+7, ' +
          '$' + sL + '2<>"Done", $' + sL + '2<>"Won\'t do", $' + sL + '2<>"Not an issue")')
        .setBackground('#FDF0D5').setFontColor('#8A5A00')
        .setRanges([dueRange]).build());
    }
  }

  // An unassigned open item is the thing that quietly rots. Make it red.
  var ownerCol = colNum_(t, 'Owner');
  var assigneeC = colNum_(t, 'Assignee');
  if (ownerCol && assigneeC && statusCol) {
    var a1Status = colLetter_(statusCol);
    var a1Owner  = colLetter_(ownerCol);
    var a1Assign = colLetter_(assigneeC);
    // Written out longhand rather than COUNTIF over an array literal: array
    // separators are locale-dependent and would silently stop matching.
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(
        '=AND($' + a1Status + '2<>"", $' + a1Status + '2<>"Done", $' + a1Status + '2<>"Won\'t do", ' +
        '$' + a1Status + '2<>"Not an issue", $' + a1Owner + '2="", $' + a1Assign + '2="")')
      .setBackground('#FBEAE9')
      .setRanges([sheet.getRange(2, ownerCol, bodyRows, 1)]).build());
  }

  sheet.setConditionalFormatRules(rules);

  // Master-owned columns inside a PROJECT tab are visually dead: grey, so
  // nobody wastes time typing into a cell the sync will overwrite tonight.
  if (!isMaster) {
    writebackColumns_().forEach(function (name) {
      var n = colNum_(t, name);
      if (n && name !== 'Status') sheet.getRange(2, n, bodyRows, 1).setBackground(BRAND.LOCKED_BG);
    });
    return;
  }

  // The master Suggestions tab is the one tab all staff can edit — that is the
  // whole point of Channel B. Warning-only protection on ICT's columns nudges
  // without locking: a hard lock here would also block the person who raised
  // the row from fixing their own typo in the row next to it.
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (/^\[tracker\]/.test(p.getDescription() || '')) p.remove();
  });

  // Only the SYNC-owned columns are protected here. Status, Assignee, Waiting
  // on and Note are exactly what the weekly triage edits — a warning dialog on
  // every one of those would be friction aimed at the two people we least want
  // to slow down.
  columnsOwnedBy_(masterSuggestionColumns_(), 'sync').forEach(function (name) {
    var n = colNum_(t, name);
    if (!n) return;
    sheet.getRange(2, n, bodyRows, 1).setBackground(BRAND.LOCKED_BG);
    sheet.getRange(2, n, bodyRows, 1).protect()
      .setDescription('[tracker] ' + name + ' is stamped automatically')
      .setWarningOnly(true);
  });
}

function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
}

function formatTrackerSheet_(sheet) {
  var t = readTable_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  headerStyle_(sheet, lastCol);
  applyWidths_(sheet, t, trackerColumns_());

  if (sheet.getLastRow() > 1) {
    var body = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol);
    body.setFontSize(10).setVerticalAlignment('top').setWrap(true);
    sheet.getBandings().forEach(function (b) { b.remove(); });
    var banding = body.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
    banding.setFirstRowColor(BRAND.BAND_A);
    banding.setSecondRowColor(BRAND.BAND_B);
  }

  var rules = [];
  var statusCol = colNum_(t, 'Current Status');
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);

  if (statusCol) {
    var r = sheet.getRange(2, statusCol, rowCount, 1);
    [['Launched', '#E3F2E4', '#2E7D32'],
     ['Building', '#FDF0D5', '#9A6400'],
     ['Launching', '#E6F0FA', '#1C4E9D'],
     ['Testing', '#EDE7F6', '#5E35B1'],
     ['Paused', '#EEF0F2', '#5F6469']].forEach(function (spec) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextContains(spec[0]).setBackground(spec[1]).setFontColor(spec[2])
        .setRanges([r]).build());
    });
  }

  // Blank Owner is the point of the §4.5 split — it has to be loud.
  var ownerCol = colNum_(t, 'Owner');
  if (ownerCol) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenCellEmpty()
      .setBackground('#FBEAE9').setFontColor('#C0271F')
      .setRanges([sheet.getRange(2, ownerCol, rowCount, 1)]).build());

    var staff = sheet.getParent().getSheetByName(CONFIG.TAB.STAFF);
    if (staff) {
      sheet.getRange(2, ownerCol, rowCount, 1).setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInRange(staff.getRange(2, 1, Math.max(staff.getMaxRows() - 1, 1), 1), true)
          .setAllowInvalid(true)
          .build());
    }
  }

  sheet.setConditionalFormatRules(rules);
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
}

// ---------- Protection ----------

/**
 * Staff need edit rights on the spreadsheet so Channel B works at all
 * (SUGGESTIONS_SYSTEM.md §4.2). Everything except the Suggestions tab is then
 * locked to Dan and the leads. Google enforces this, not our code.
 *
 * Leads = Staff rows whose Role mentions Lead or ICT and that carry an email.
 */
function applyProtection_(ss) {
  var editors = leadEmails_(ss);

  // Refuse to protect anything until at least one lead has an email in the
  // Staff tab. Otherwise the first Setup run would strip every editor from
  // every tab and lock the leads out of their own tracker.
  if (!editors.length) {
    return 'Skipped tab protection: no leads with an email in the Staff tab yet. ' +
           'Fill Name + Email + Role ("Lead") there, then run Setup again.';
  }

  var me = Session.getEffectiveUser().getEmail();
  if (me && editors.indexOf(me) === -1) editors.push(me);

  var openTab = CONFIG.TAB.SUGGESTIONS;

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();

    // Clear only the protections this script created, so manual ones survive.
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) {
      if (/^\[tracker\]/.test(p.getDescription() || '')) p.remove();
    });

    if (name === openTab) {
      // Deliberately unprotected: this is the write surface for all staff.
      return;
    }

    var p = sheet.protect().setDescription('[tracker] ' + name + ' — ICT only');
    try {
      p.removeEditors(p.getEditors().map(function (u) { return u.getEmail(); })
        .filter(function (e) { return editors.indexOf(e) === -1 && e !== me; }));
    } catch (e) { /* the file owner cannot be removed; that is fine */ }
    try { p.addEditors(editors); } catch (e) { /* an editor may not have file access yet */ }
  });

  return 'Tabs locked to: ' + editors.join(', ') + '. Only "' + openTab + '" is open to all staff.';
}

function leadEmails_(ss) {
  var sheet = (ss || SpreadsheetApp.getActiveSpreadsheet()).getSheetByName(CONFIG.TAB.STAFF);
  if (!sheet) return [];
  var t = readTable_(sheet);
  var out = [];
  t.rows.forEach(function (r) {
    var email = str_(t, r, 'Email');
    var role  = str_(t, r, 'Role');
    var active = String(cell_(t, r, 'Active')).toLowerCase();
    if (!email || active === 'false') return;
    // Word-boundary, not substring. `/admin/` matched "Administrative Assistant"
    // and "Office Administrator", silently handing them edit rights on every
    // protected tab — privilege escalation by job title. `\badmin\b` does not
    // match either, while "Academic Lead" and "ICT" still do.
    if (/\b(lead|leads|leadership|ict|admin)\b/i.test(role)) out.push(email);
  });
  return uniq_(out);
}
