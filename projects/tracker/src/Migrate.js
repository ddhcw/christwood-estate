/**
 * Christwood ICT — Projects Tracker
 * Migrate.js — the one-time cleanup, always dry-run first.
 *
 * Three problems, from SUGGESTIONS_SYSTEM.md §3:
 *   §3.3  Seven projects hold "To be managed by one person within the X Group."
 *         A to-do disguised as data. Because the cell is non-empty, the gap is
 *         invisible. Blank it, and let the red chip do the arguing.
 *   §3.4  Monica / Monica Angel, Stella / Stella Baby — two people become four
 *         in any owner filter.
 *   §3.1  Three incompatible vocabularies for one concept across the project
 *         files. Fix at 21 files; at 40 it is a project.
 *
 * Nothing here writes until you have read the report and confirmed.
 */

// ---------- Report ----------

/**
 * Works out everything the migration would change, and changes nothing.
 * @return {Object} report
 */
function migrationReport() {
  return guarded_('migrationReport', function () {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var tracker = resolveTrackerSheet_(ss);
    var t       = readTable_(tracker);

    var report = {
      placeholders: [],   // rows whose Owner is a sentence, not a name
      unownedLive: [],    // …and the system is already Launched. The handover risk.
      collisions: [],     // Monica / Monica Angel
      multiOwner: [],     // one cell holding two names -> Owner + Contributors
      legacyTabs: [],     // project files whose Suggestions tab needs remapping
      noFile: [],         // projects with nothing to attach a tab to
      folderOnly: [],     // projects that are a Drive folder, not one sheet
      staffMissing: []    // names in the tracker with no Staff row
    };

    var links = readLinkColumn_(tracker, t, 'Link to Google Sheet(s)');
    var seenNames = {};

    t.rows.forEach(function (row, i) {
      if (isBlankRow_(row)) return;
      var name = str_(t, row, 'Name');
      if (!name) return;

      var rawOwner = str_(t, row, 'Owner') || str_(t, row, 'Maintained By');
      var status   = str_(t, row, 'Current Status');

      if (isOwnerPlaceholder_(rawOwner)) {
        report.placeholders.push({ project: name, text: rawOwner, group: str_(t, row, 'Responsible Group'), status: status });
        if (/launch(ed)?|live|running/i.test(status)) {
          report.unownedLive.push({ project: name, status: status, group: str_(t, row, 'Responsible Group') });
        }
      } else {
        var names = splitNames_(rawOwner);
        if (names.length > 1) report.multiOwner.push({ project: name, owner: names[0], contributors: names.slice(1) });
        names.forEach(function (n) { seenNames[n] = true; });
      }

      var link = links[i] || { kind: 'none' };
      if (link.kind === 'folder') report.folderOnly.push(name);
      else if (link.kind !== 'spreadsheet') report.noFile.push(name);
    });

    // §3.4 — one name being a word-prefix of another is almost always one person.
    var all = Object.keys(seenNames).sort();
    for (var a = 0; a < all.length; a++) {
      for (var b = 0; b < all.length; b++) {
        if (a === b) continue;
        var shortN = all[a], longN = all[b];
        if (longN.length <= shortN.length) continue;
        if (new RegExp('^' + escapeRe_(shortN) + '\\b', 'i').test(longN)) {
          report.collisions.push({ canonical: shortN, alias: longN });
        }
      }
    }

    // Which staff names have no Staff row yet.
    var staff = staffMap_();
    all.forEach(function (n) { if (!staff[n.toLowerCase()]) report.staffMissing.push(n); });

    // §3.1 — inspect every reachable project file's Suggestions tab.
    readProjects_(tracker).filter(function (p) { return p.fileId; }).forEach(function (p) {
      try {
        var psheet = withRetry_('open:' + p.name, function () {
          return SpreadsheetApp.openById(p.fileId).getSheetByName(CONFIG.TAB.SUGGESTIONS);
        }, 2, 400);
        if (!psheet) return;
        var pt = readTable_(psheet);
        var mapping = detectLegacyMapping_(pt.headers);
        if (mapping) {
          report.legacyTabs.push({
            project: p.name, fileId: p.fileId, shape: mapping.shape,
            headers: pt.headers.join(' | '), rows: pt.rows.filter(function (r) { return !isBlankRow_(r); }).length
          });
        }
      } catch (e) {
        report.legacyTabs.push({ project: p.name, fileId: p.fileId, shape: 'unreadable', headers: e.message, rows: 0 });
      }
    });

    return report;
  });
}

function escapeRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Human-readable version of the report, for the dialog. */
function migrationReportText_(r) {
  var out = [];
  var section = function (title, lines) {
    if (!lines.length) return;
    out.push('── ' + title + ' ──');
    lines.forEach(function (l) { out.push('  ' + l); });
    out.push('');
  };

  if (r.unownedLive.length) {
    out.push('⚠️  LIVE SYSTEMS WITH NOBODY NAMED');
    out.push('   Staff depend on these today and no one owns them.');
    r.unownedLive.forEach(function (u) { out.push('  • ' + u.project + '  (' + u.status + ', ' + (u.group || 'no group') + ')'); });
    out.push('');
  }

  section('Owner cells that are a sentence, not a name (' + r.placeholders.length + ')',
    r.placeholders.map(function (p) { return p.project + '  ←  "' + p.text + '"'; }));
  section('Same person, two spellings (' + r.collisions.length + ')',
    r.collisions.map(function (c) { return c.alias + '  →  ' + c.canonical; }));
  section('Owner cells holding more than one name (' + r.multiOwner.length + ')',
    r.multiOwner.map(function (m) { return m.project + ': Owner = ' + m.owner + ', Contributors = ' + m.contributors.join(', '); }));
  section('Names with no row in the Staff tab (' + r.staffMissing.length + ')', r.staffMissing);
  section('Project Suggestions tabs on the old schema (' + r.legacyTabs.length + ')',
    r.legacyTabs.map(function (l) { return l.project + '  [' + l.shape + ', ' + l.rows + ' rows]\n      ' + l.headers; }));
  section('Projects with no spreadsheet — they will use the master tab (' + r.noFile.length + ')', r.noFile);
  section('Projects that are a Drive folder, not one sheet (' + r.folderOnly.length + ')', r.folderOnly);

  out.push('Nothing has been changed. Choose "Apply migration" to make these changes.');
  return out.join('\n');
}

// ---------- Apply ----------

/**
 * Applies the migration. Idempotent — running it twice changes nothing the
 * second time.
 *
 * Safety: every project Suggestions tab is copied to a dated backup tab before
 * it is touched, and unrecognised status text is preserved into Note rather
 * than discarded.
 */
function applyMigration() {
  return guarded_('applyMigration', function () {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var tracker = resolveTrackerSheet_(ss);
    var report  = migrationReport();
    var done    = [];

    // 1. Record collisions in the Staff tab so the canonical form is data, not code.
    var staffSheet = ss.getSheetByName(CONFIG.TAB.STAFF);
    if (staffSheet && report.collisions.length) {
      var st = readTable_(staffSheet);
      var aliasCol = colNum_(st, 'Aliases');
      var rowOfName = {};
      st.rows.forEach(function (r, i) {
        var n = str_(st, r, 'Name');
        if (n) rowOfName[n.toLowerCase()] = i;
      });

      var aliasVals = aliasCol && st.rows.length
        ? staffSheet.getRange(st.firstDataRow, aliasCol, st.rows.length, 1).getValues() : [];
      var touched = false;

      report.collisions.forEach(function (c) {
        var i = rowOfName[c.canonical.toLowerCase()];
        if (i === undefined || !aliasCol) return;
        var current = splitNames_(aliasVals[i][0]);
        if (current.map(function (x) { return x.toLowerCase(); }).indexOf(c.alias.toLowerCase()) === -1) {
          current.push(c.alias);
          aliasVals[i][0] = current.join(', ');
          touched = true;
        }
      });
      if (touched) {
        staffSheet.getRange(st.firstDataRow, aliasCol, st.rows.length, 1).setValues(aliasVals);
        done.push(report.collisions.length + ' name spellings folded into the Staff tab.');
      }

      // Remove the now-alias rows so dropdowns show one entry per person.
      var toDelete = [];
      report.collisions.forEach(function (c) {
        var i = rowOfName[c.alias.toLowerCase()];
        if (i !== undefined) toDelete.push(st.firstDataRow + i);
      });
      toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { staffSheet.deleteRow(r); });
    }

    // 2. Clean the tracker's Owner column.
    var t = readTable_(tracker);
    var ownerCol = colNum_(t, 'Owner');
    var contribCol = colNum_(t, 'Contributors');
    if (ownerCol && t.rows.length) {
      var staff = staffMap_();
      var owners  = tracker.getRange(t.firstDataRow, ownerCol, t.rows.length, 1).getValues();
      var contribs = contribCol ? tracker.getRange(t.firstDataRow, contribCol, t.rows.length, 1).getValues() : null;
      var blanked = 0, folded = 0, split = 0;

      for (var i = 0; i < t.rows.length; i++) {
        var raw = String(owners[i][0] || '').trim();
        if (!raw) continue;

        if (isOwnerPlaceholder_(raw)) {
          owners[i][0] = '';           // the whole point: make the gap visible
          blanked++;
          continue;
        }

        var names = splitNames_(raw).map(function (n) {
          var rec = staff[n.toLowerCase()];
          if (rec && rec.name !== n) { folded++; return rec.name; }
          return n;
        });

        owners[i][0] = names[0] || '';
        if (names.length > 1 && contribs) {
          var existing = splitNames_(contribs[i][0]);
          contribs[i][0] = uniq_(existing.concat(names.slice(1))).join(', ');
          split++;
        }
      }

      tracker.getRange(t.firstDataRow, ownerCol, t.rows.length, 1).setValues(owners);
      if (contribs) tracker.getRange(t.firstDataRow, contribCol, t.rows.length, 1).setValues(contribs);

      if (blanked) done.push(blanked + ' placeholder sentences blanked — those projects now show as Unassigned.');
      if (folded)  done.push(folded + ' owner names normalised to their canonical spelling.');
      if (split)   done.push(split + ' multi-name owner cells split into Owner + Contributors.');
    }

    // 3. Convert every legacy project Suggestions tab to the canonical schema.
    report.legacyTabs.forEach(function (l) {
      if (l.shape === 'unreadable') return;
      try {
        var converted = convertLegacyTab_(l.fileId, l.project);
        if (converted) done.push('Converted "' + l.project + '" Suggestions tab (' + converted + ' rows) to the shared schema.');
      } catch (e) {
        done.push('⚠️ Could not convert "' + l.project + '": ' + e.message);
      }
    });

    formatTrackerSheet_(tracker);
    clearBootstrapCache_();
    clearSettingsCache_();

    var summary = done.length ? done.join('\n') : 'Nothing needed changing — the migration has already run.';
    audit_('Migration', '', '', 'Migration applied', summary.replace(/\n/g, ' · '));
    return summary;
  });
}

/**
 * Rewrites one project's Suggestions tab onto the canonical schema.
 * The original tab is renamed to a dated backup first — nothing is ever
 * destroyed (non-negotiable #10).
 */
function convertLegacyTab_(fileId, projectName) {
  var ss  = withRetry_('open:' + projectName, function () { return SpreadsheetApp.openById(fileId); }, 3, 500);
  var old = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
  if (!old) return 0;

  var t = readTable_(old);
  var mapping = detectLegacyMapping_(t.headers);
  if (!mapping) return 0;                        // already canonical

  // An unrecognised shape has no column mapping at all, so every pick() below
  // would resolve to '' and every row would be skipped — leaving a brand new
  // EMPTY Suggestions tab in front of the staff, with their rows alive but
  // hidden in the backup tab. Refuse instead: a tab we cannot read is a tab we
  // must not replace.
  if (mapping.shape === 'unknown') {
    throw new Error('The Suggestions tab in "' + projectName + '" has headers this system does not ' +
      'recognise (' + t.headers.join(' | ') + '). Nothing was changed. Either rename its columns to ' +
      'match the standard schema, or rename the tab and let the installer create a fresh one.');
  }

  var cols  = suggestionColumns_();
  var names = columnNames_(cols);
  var today = todayStr_();

  var rows = [];
  t.rows.forEach(function (row) {
    if (isBlankRow_(row)) return;

    var pick = function (canonical) {
      var src = mapping[canonical];
      return src ? str_(t, row, src) : '';
    };

    var headline = pick('Suggestion');
    var details  = pick('Details');
    if (mapping.shape === 'call-logs') {
      // "Further Details" is the real content; the headline is its first line.
      details  = str_(t, row, 'Further Details');
      headline = details.split(/\n|\.\s/)[0].substr(0, 120);
    }
    if (!headline && !details) return;

    var st = normalizeStatus_(pick('Status'));
    var note = st.residue ? 'Original status text: "' + st.residue + '"' : '';

    var rec = {
      'Ref':          newRef_(),
      'Type':         normalizeType_(pick('Type')) || 'Improvement',
      'Suggestion':   headline,
      'Details':      details,
      'Submitted by': pick('Submitted by'),
      'Raised on':    today,
      'Status':       st.status,
      'Assignee':     '',
      'Waiting on':   '',
      'Note':         note,
      'Resolved on':  isClosedStatus_(st.status) ? (st.resolvedOn || today) : '',
      'Owner':        ''
    };
    rows.push(rowFromRecord_(cols, rec));
  });

  var backupName = 'Suggestions (pre-migration ' + today + ')';
  if (!ss.getSheetByName(backupName)) old.setName(backupName);
  else old.setName(backupName + ' ' + Utilities.getUuid().substr(0, 4));
  old.hideSheet();

  var fresh = ss.insertSheet(CONFIG.TAB.SUGGESTIONS, 0);
  fresh.getRange(1, 1, 1, names.length).setValues([names]);
  if (rows.length) fresh.getRange(2, 1, rows.length, names.length).setValues(rows);

  decorateProjectTab_(fresh, projectName);
  return rows.length;
}

// ---------- Seeding the open threads from the brief (§8) ----------

/**
 * The threads that were live when this system was designed. Dan confirms
 * before they land. Re-running is safe: matching rows are skipped.
 */
function seedItems_() {
  // Two of these are Requests, not Threads: the section renames and the
  // admission-number revision are the school changing its own structure, which
  // the systems then have to follow. They were never ours to decline.
  return [
    // project, type, headline, details, submittedBy, raisedOn, waitingOn
    ['Staff Intranet',          'Thread', 'Statutory renewals list',            'Needs the renewals and their dates fed in before the list can be built.', 'Dan', '2026-05-07', 'Johnson Sir'],
    ['Leaves & Substitutions',  'Thread', 'CEO daily notifications',            'Needs the 26-27 tracker created first.',                                  'Dan', '2026-05-07', "Vennila Ma'am"],
    ['LP / Weekly Report',      'Request', 'G11 & G12 Planner section renames', 'Science/Commerce → Emerald/Pearl/Ruby. This is blocking the Weekly Report.', 'Dan', '2026-07-07', 'Acham'],
    ['LP / LP Review',          'Thread', 'Six queries fielded, fix pending',   'Six queries were raised and answered; the fix waits on her responses.',    'Dan', '2026-06-23', 'Acham'],
    ['Student emails',          'Request', 'Rollout pending admission-number revision', 'Cannot roll out until admission numbers are revised.',            'Dan', '2026-08-20', 'Monica / admissions'],
    ['Transport',               'Thread', 'One remaining point from Mr Lakshmanan', 'One outstanding point raised by Mr Lakshmanan.',                      'Dan', '2026-08-13', 'Lakshmanan'],

    ['Data Fiesta – Academics', 'Thread', 'To alpha by SA1',                    'Target: alpha release by SA1.',                                           'Dan', '', ''],
    ['Student Records',         'Thread', 'Single-window view of a child',      'One screen showing everything about a child at school.',                  'Dan', '', ''],
    ['Question Papers Management System', 'Thread', 'Design stage',             'Nothing built yet — suggestions are the project at this point.',          'Dan', '', ''],
    ['LATE tracker',            'Thread', 'Build LATE tracker',                 '',                                                                        'Dan', '', ''],
    ['Student Attendance',      'Thread', 'Log permissions to leave campus',    'Extension of the Attendance system: log student permissions to leave campus.', 'Dan', '', ''],
    ['Marks Management',        'Thread', 'Mark-entry change tracker',          'Prem builds it, Dan automates it.',                                       'Dan', '', '']
  ];
}

/**
 * Inserts the §8 threads into the master tab, skipping any that are already
 * there. Dedupe is on project + headline, so re-running never duplicates.
 */
function seedOpenThreads() {
  return guarded_('seedOpenThreads', function () {
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var master = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
    if (!master) throw new Error('Run "Set up / repair all tabs" first.');

    var t = readTable_(master);
    var seen = {};
    t.rows.forEach(function (r) {
      var k = (str_(t, r, 'Project') + '|' + str_(t, r, 'Suggestion')).toLowerCase();
      if (k !== '|') seen[k] = true;
    });

    var tracker = resolveTrackerSheet_(ss);
    var projects = {};
    readProjects_(tracker).forEach(function (p) { projects[p.name.toLowerCase()] = p; });

    var records = [], unmatched = [];

    seedItems_().forEach(function (s) {
      var key = (s[0] + '|' + s[2]).toLowerCase();
      if (seen[key]) return;
      var p = projects[s[0].toLowerCase()];
      if (!p) unmatched.push(s[0]);

      var rec = {
        'Project':      s[0],
        'Ref':          newRef_(),
        'Type':         s[1],
        'Suggestion':   s[2],
        'Details':      s[3],
        'Submitted by': s[4],
        'Raised on':    s[5] || todayStr_(),
        'Status':       s[6] ? CONFIG.STATUS.ACCEPTED : CONFIG.STATUS.NEW,
        'Assignee':     '',
        'Waiting on':   s[6],
        'Note':         '',
        'Resolved on':  '',
        'Owner':        p ? p.owner : '',
        'Origin':       'Master'
      };
      records.push(rec);
    });

    // Align to the master tab's ACTUAL headers, not to the canonical order.
    // A tracker upgraded from an older schema keeps its legacy columns in place
    // and has the canonical ones appended to the right, so a positional write
    // lands every value one or more columns adrift — which is how a seeded
    // thread ended up with its Ref in the "Link" column and its headline in
    // "Suggestion by".
    var written = 0;
    if (records.length) {
      var mt = readTable_(master);
      var width = Math.max(mt.headers.length, 1);
      var byKey = {};
      mt.headers.forEach(function (h, i) {
        var k = normalizeKey_(h);
        if (k && byKey[k] === undefined) byKey[k] = i;
      });

      var aligned = records.map(function (rec) {
        var out = new Array(width).fill('');
        Object.keys(rec).forEach(function (name) {
          var i = byKey[normalizeKey_(name)];
          if (i !== undefined) out[i] = rec[name];
        });
        return out;
      });

      var start = Math.max(master.getLastRow() + 1, 2);
      master.getRange(start, 1, aligned.length, width).setValues(aligned);
      written = aligned.length;
    }

    clearBootstrapCache_();
    var msg = written
      ? written + ' open threads seeded into the master tab.'
      : 'All seed threads are already there — nothing added.';
    if (unmatched.length) {
      msg += '\n\n⚠️ These seed rows use a project name that is not in the tracker, so they will not inherit an owner:\n  • ' +
             uniq_(unmatched).join('\n  • ') +
             '\n\nEither rename them in the Suggestions tab to match, or add the project to the tracker.';
    }
    audit_('Seed', '', '', written + ' threads seeded', unmatched.join(', '));
    return msg;
  });
}
