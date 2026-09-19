/**
 * Christwood ICT — Projects Tracker
 * Sync.js — pulls each project's own Suggestions tab into the master, and
 * pushes ICT's answers back down.
 *
 * The two rules that make a two-way sync safe:
 *   • Ref, never row number. A staff member inserting a row above their entry
 *     must not re-import the whole tab (SUGGESTIONS_SYSTEM.md §4.3).
 *   • Each side owns different columns (Schema.js). Nothing is ever merged;
 *     the owner of a column simply wins.
 *
 * The project list comes from the tracker's own link column. Adding project 22
 * needs no code change (C3). Only spreadsheet-shaped links are pulled —
 * folders and empty cells are skipped by design, and those projects use the
 * master Suggestions tab instead (C6).
 *
 * Writes are per-column, not whole-range, so a staff member typing during the
 * two seconds the sync is writing cannot have their words overwritten.
 */

// ---------- Entry points ----------

/** Nightly trigger. */
function syncNightly() {
  return runSync_('nightly');
}

/** "Sync now" menu item, for when Dan is on site. */
function syncNow() {
  var result = runSync_('manual');
  try { SpreadsheetApp.getUi().alert('Sync complete\n\n' + result.summary); } catch (e) {}
  return result;
}

// ---------- The run ----------

function runSync_(mode) {
  return guarded_('syncNightly', function () {
    var settings = getSettings_();
    if (!settings.sync_enabled && mode === 'nightly') {
      return { summary: 'Sync is switched off in the Config tab.', skipped: true };
    }

    var lock = acquireLock_(30000);
    if (!lock) return { summary: 'Another sync is already running. Nothing done.', skipped: true };

    var started = Date.now();
    try {
      var ss      = SpreadsheetApp.getActiveSpreadsheet();
      var tracker = resolveTrackerSheet_(ss);
      var master  = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
      if (!master) throw new Error('No "' + CONFIG.TAB.SUGGESTIONS + '" tab. Run Tracker Tools → Set up / repair all tabs first.');

      var projects = readProjects_(tracker);
      var pullable = projects.filter(function (p) { return p.fileId; });

      var state = loadMasterState_(master, ss);
      var stats = {
        filesRead: 0, filesFailed: 0, imported: 0, updated: 0,
        refsStamped: 0, writtenBack: 0, closures: [], errors: [], deferred: 0,
        pulledUp: [], delivered: []
      };

      // Resume where a previous run ran out of time, if it did.
      var props   = PropertiesService.getScriptProperties();
      var pending = safeJson_(props.getProperty('SYNC_PENDING'), null);
      var queue   = pending && pending.length
        ? pullable.filter(function (p) { return pending.indexOf(p.name) !== -1; })
        : pullable;

      var remaining = [];
      for (var i = 0; i < queue.length; i++) {
        if (Date.now() - started > CONFIG.MAX_RUNTIME_MS) {
          remaining = queue.slice(i).map(function (p) { return p.name; });
          stats.deferred = remaining.length;
          break;
        }
        pullProject_(queue[i], state, stats, settings);
      }

      if (remaining.length) props.setProperty('SYNC_PENDING', JSON.stringify(remaining));
      else props.deleteProperty('SYNC_PENDING');

      // Master-raised rows still need Refs, dates and inherited owners.
      normaliseMasterRows_(master, state, projects, stats);

      // Persist everything in one pass per changed column.
      commitMaster_(master, state, stats);

      // Push ICT's answers back down into each project's own tab.
      if (settings.writeback_enabled) writeBackAll_(master, state, stats, settings, projects);

      var archived = archiveSweep_(ss, settings);
      var emailed  = notifyRaisers_(stats.closures);

      props.setProperty('LAST_SYNC_OK', String(Date.now()));
      props.setProperty('LAST_SYNC_SUMMARY', JSON.stringify({
        at: fmtDateTime_(new Date()),
        files: stats.filesRead, failed: stats.filesFailed,
        imported: stats.imported, updated: stats.updated, archived: archived
      }));

      clearBootstrapCache_();
      flushAlertBudget_();

      var summary = [
        stats.filesRead + ' project file' + (stats.filesRead === 1 ? '' : 's') + ' read' +
          (stats.filesFailed ? ', ' + stats.filesFailed + ' failed' : ''),
        stats.imported + ' new, ' + stats.updated + ' updated',
        stats.refsStamped ? stats.refsStamped + ' refs stamped' : '',
        stats.writtenBack ? stats.writtenBack + ' columns written back' : '',
        stats.pulledUp.length ? stats.pulledUp.length + ' change' + (stats.pulledUp.length === 1 ? '' : 's') +
          ' made in a project file pulled up into the master' : '',
        stats.delivered.length ? stats.delivered.length + ' suggestion' + (stats.delivered.length === 1 ? '' : 's') +
          (stats.delivered[0].dryRun
            ? ' would be delivered to project files (central_delivery is dry-run)'
            : ' delivered to project files') : '',
        archived ? archived + ' archived' : '',
        emailed ? emailed + ' raiser' + (emailed === 1 ? '' : 's') + ' told' : '',
        stats.deferred ? stats.deferred + ' deferred to the next run (time limit)' : '',
        projects.length - pullable.length + ' project' + ((projects.length - pullable.length) === 1 ? '' : 's') +
          ' have no spreadsheet — they use the master tab'
      ].filter(String).join('\n');

      if (stats.pulledUp.length) {
        auditBatch_(stats.pulledUp.map(function (p) {
          return ['Pulled up', p.ref, p.project,
                  p.column + ': "' + p.from + '" → "' + p.to + '" (edited in the project file)'];
        }));
      }
      if (stats.delivered.length) {
        auditBatch_(stats.delivered.map(function (d) {
          return [d.dryRun ? 'Would deliver' : 'Delivered', d.ref, d.project,
                  d.dryRun
                    ? 'central_delivery is dry-run — nothing written'
                    : 'Inserted into ' + d.project + '’s own Suggestions tab'];
        }));
      }
      audit_('Sync', '', '', 'Sync (' + mode + ') in ' + Math.round((Date.now() - started) / 1000) + 's', summary.replace(/\n/g, ' · '));

      return { summary: summary, stats: stats };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  });
}

// ---------- Reading the tracker ----------

/**
 * The project list IS the sync config. Returns every tracker row with the
 * spreadsheet id extracted from the link column — including rows where there
 * is no file, because those still need an Owner for inheritance.
 */
function readProjects_(tracker) {
  var t = readTable_(tracker);
  var links = readLinkColumn_(tracker, t, 'Link to Google Sheet(s)');

  var out = [];
  t.rows.forEach(function (row, i) {
    if (isBlankRow_(row)) return;
    var name = str_(t, row, 'Name');
    if (!name) return;

    var owner = str_(t, row, 'Owner');
    if (isOwnerPlaceholder_(owner)) owner = '';

    out.push({
      name:    name,
      owner:   owner,
      group:   str_(t, row, 'Responsible Group'),
      status:  str_(t, row, 'Current Status'),
      details: str_(t, row, 'Details (What It Automates)'),
      sheetUrl: str_(t, row, 'Link to Google Sheet(s)'),
      appUrl:  str_(t, row, 'Link to GAS Web App'),
      docsUrl: str_(t, row, 'Documentation/Instructions Link'),
      costs:   str_(t, row, 'Other Costs (Hardware/Software)'),
      contributors: splitNames_(str_(t, row, 'Contributors')),
      fileId:  (links[i] && links[i].kind === 'spreadsheet') ? links[i].id : '',
      linkKind: links[i] ? links[i].kind : 'none',
      // A cell may display "Call Logs" with the URL hidden underneath. Rebuild
      // it from the extracted id so the app's Sheet button still works.
      resolvedSheetUrl: (links[i] && links[i].kind === 'spreadsheet')
        ? 'https://docs.google.com/spreadsheets/d/' + links[i].id + '/edit' : '',
      rowNumber: t.firstDataRow + i
    });
  });
  return out;
}

// ---------- Master state, held in memory for the whole run ----------

function loadMasterState_(master, ss) {
  var t = readTable_(master);
  var byRef = {};
  var rows = [];

  // Every data row is kept, blanks included, so index i in `rows` is always
  // sheet row firstDataRow + i. Dropping blanks here would silently shift every
  // later row during commit — which writes one person's answer onto another's.
  t.rows.forEach(function (row, i) {
    var copy = row.slice();
    var blank = isBlankRow_(row);
    var ref = blank ? '' : String(cell_(t, copy, 'Ref')).trim();
    var rec = { ref: ref, values: copy, rowIndex: i, dirty: false, blank: blank };
    rows.push(rec);
    if (ref) byRef[ref] = rec;
  });

  // Refs already archived must not be re-imported when the project file still
  // has the row. Without this the archive sweep would loop forever.
  var archivedRefs = {};
  var archive = ss.getSheetByName(CONFIG.TAB.ARCHIVE);
  if (archive && archive.getLastRow() > 1) {
    var at = readTable_(archive);
    at.rows.forEach(function (r) {
      var ref = String(cell_(at, r, 'Ref')).trim();
      if (ref) archivedRefs[ref] = true;
    });
  }

  return {
    table: t, rows: rows, byRef: byRef, archivedRefs: archivedRefs,
    added: [], width: Math.max(t.headers.length, 1)
  };
}

function setMasterValue_(state, rec, headerName, value) {
  var i = state.table.idx[normalizeKey_(headerName)];
  if (i === undefined) return false;
  var current = rec.values[i];
  var cur = (current instanceof Date) ? fmtDate_(current) : String(current === null || current === undefined ? '' : current);
  var nxt = (value instanceof Date) ? fmtDate_(value) : String(value === null || value === undefined ? '' : value);
  if (cur === nxt) return false;
  rec.values[i] = value;
  rec.dirty = true;
  return true;
}

function getMasterValue_(state, rec, headerName) {
  var i = state.table.idx[normalizeKey_(headerName)];
  if (i === undefined) return '';
  var v = rec.values[i];
  if (v instanceof Date) return fmtDate_(v);
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function newMasterRow_(state) {
  var values = new Array(state.width).fill('');
  var rec = { ref: '', values: values, rowIndex: -1, dirty: true, isNew: true };
  state.added.push(rec);
  return rec;
}

// ---------- Pulling one project ----------

function pullProject_(project, state, stats, settings) {
  try {
    var ss = withRetry_('open:' + project.name, function () {
      return SpreadsheetApp.openById(project.fileId);
    }, 3, 600);

    var tab = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
    if (!tab) {
      // Not an error — most projects legitimately have no tab yet.
      forgetSuggestTarget_(project.name);
      recordSuccess_(project.name);
      return;
    }

    // The sync already has the file open, so the "Suggest" deep link is free
    // here and would cost a cross-file read at page load (C4).
    rememberSuggestTarget_(project.name, ss, tab);

    var t = readTable_(tab);
    if (!t.headers.length) { recordSuccess_(project.name); return; }

    var refCol = colNum_(t, 'Ref');
    var refUpdates = [];      // [rowOffset, newRef]
    var seenRefs = {};

    t.rows.forEach(function (row, i) {
      if (isBlankRow_(row)) return;

      var suggestion = str_(t, row, 'Suggestion');
      var details    = str_(t, row, 'Details');
      if (!suggestion && !details) return;   // a half-typed row is not a suggestion yet

      var ref = String(cell_(t, row, 'Ref')).trim();
      if (!ref) {
        ref = newRef_();
        refUpdates.push([i, ref]);
        stats.refsStamped++;
      }
      seenRefs[ref] = true;

      if (state.archivedRefs[ref]) return;   // already closed and filed away

      var rec = state.byRef[ref];
      var isNew = false;
      if (!rec) {
        rec = newMasterRow_(state);
        rec.ref = ref;
        state.byRef[ref] = rec;
        isNew = true;
        setMasterValue_(state, rec, 'Ref', ref);
        setMasterValue_(state, rec, 'Origin', project.name);
        setMasterValue_(state, rec, 'Project', project.name);
        stats.imported++;
      }

      // Project-owned columns: the file always wins.
      var changed = false;
      changed = setMasterValue_(state, rec, 'Type',         normalizeType_(str_(t, row, 'Type')) || 'Improvement') || changed;
      changed = setMasterValue_(state, rec, 'Suggestion',   suggestion || details.substr(0, 120)) || changed;
      changed = setMasterValue_(state, rec, 'Details',      details) || changed;
      changed = setMasterValue_(state, rec, 'Submitted by', str_(t, row, 'Submitted by')) || changed;
      if (!isNew && changed) stats.updated++;

      // Before the master pushes its answers back down, check whether a human
      // changed one of those answers HERE, in their own file.
      reconcileMasterOwned_(state, rec, t, row, project, stats);

      rec._project = project;
      rec._sourceFileId = project.fileId;
    });

    if (refUpdates.length && refCol) {
      // One column write, not one per cell.
      var colValues = tab.getRange(t.firstDataRow, refCol, t.rows.length, 1).getValues();
      refUpdates.forEach(function (u) { colValues[u[0]][0] = u[1]; });
      tab.getRange(t.firstDataRow, refCol, t.rows.length, 1).setValues(colValues);
    }

    stats.filesRead++;
    if (recordSuccess_(project.name)) {
      postChatCard_(opsKeyForGroup_(project.group), '✅ ' + project.name + ' is syncing again', null,
        [['Recovered', 'The Suggestions tab is readable again. No action needed.']], []);
    }

  } catch (err) {
    stats.filesFailed++;
    var msg = err && err.message ? err.message : String(err);
    stats.errors.push(project.name + ': ' + msg);

    var f = recordFailure_(project.name, msg);
    if (f.shouldAlert) {
      opsAlert_(opsKeyForGroup_(project.group), '⚠️ Cannot read ' + project.name, [
        ['Project', project.name],
        ['Group', project.group || '—'],
        ['Failed', f.streak + ' nights in a row'],
        ['Error', msg],
        ['Likely cause', /not found|permission|access/i.test(msg)
          ? 'The file was moved, deleted, or ICT lost access to it.'
          : 'Transient Drive error — it may fix itself tonight.']
      ], { signature: 'pull|' + project.name + '|' + msg.substr(0, 60), link: project.sheetUrl });
    }
  }
}

/**
 * Resolves a disagreement between a project file and the master over a column
 * the master owns — Status, Assignee, Waiting on, Needed by, Note.
 *
 * Why this exists: `Status` is master-owned, so writeBackAll_ pushes the
 * master's value down. If someone marks an item Done in the project's own tab,
 * the next sync silently reverts it and nothing anywhere records that a
 * decision was destroyed. That breaks the house rule that regeneration never
 * destroys entered data, and it destroys it for the one person most likely to
 * be right.
 *
 * The `Pushed` fingerprint is what makes the two cases distinguishable:
 *
 *   project value == what we last wrote  -> nobody touched it; master wins.
 *   project value != what we last wrote  -> a human typed it; THEY win, and
 *                                           the change is pulled up and audited.
 *
 * Rows with no fingerprint yet (written before this existed) fall back to:
 * a non-empty project value that differs from the master is a human edit.
 * Writeback has been keeping the two equal, so a difference means someone typed.
 */
function reconcileMasterOwned_(state, rec, t, row, project, stats) {
  var stored = parseFingerprint_(getMasterValue_(state, rec, 'Pushed'));

  columnsOwnedBy_(suggestionColumns_(), 'master').forEach(function (name) {
    if (!colNum_(t, name)) return;                 // older project tabs lack some columns

    var projVal   = str_(t, row, name);
    var masterVal = getMasterValue_(state, rec, name);
    if (projVal === masterVal) return;

    if (!isHumanEdit_(projVal, masterVal, stored[name])) return;   // master changed; push down as usual

    setMasterValue_(state, rec, name, projVal);
    stats.pulledUp.push({
      ref: rec.ref, project: project.name, column: name,
      from: masterVal || '(blank)', to: projVal
    });
  });
}

// ---------- Master-side normalisation ----------

/**
 * Applies to every master row regardless of origin: give it a Ref, stamp
 * Raised on, inherit the project Owner, and stamp Resolved on the first time
 * a status becomes final. That last one doubles as the "who do we email"
 * signal — no separate state needed.
 */
function normaliseMasterRows_(master, state, projects, stats) {
  var byName = {};
  projects.forEach(function (p) { byName[p.name.toLowerCase()] = p; });

  var today = todayStr_();

  state.rows.concat(state.added).forEach(function (rec) {
    var suggestion = getMasterValue_(state, rec, 'Suggestion');
    var details    = getMasterValue_(state, rec, 'Details');
    if (!suggestion && !details) return;

    if (!getMasterValue_(state, rec, 'Ref')) {
      var ref = newRef_();
      rec.ref = ref;
      state.byRef[ref] = rec;
      setMasterValue_(state, rec, 'Ref', ref);
    }

    if (!getMasterValue_(state, rec, 'Origin')) setMasterValue_(state, rec, 'Origin', 'Master');
    if (!getMasterValue_(state, rec, 'Raised on')) setMasterValue_(state, rec, 'Raised on', today);

    var status = getMasterValue_(state, rec, 'Status');
    if (!status) { status = CONFIG.STATUS.NEW; setMasterValue_(state, rec, 'Status', status); }

    if (!getMasterValue_(state, rec, 'Type')) setMasterValue_(state, rec, 'Type', 'Improvement');

    // Owner is inherited, never typed. Assignee overrides it when set.
    var projectName = getMasterValue_(state, rec, 'Project');
    var p = byName[String(projectName).toLowerCase()];
    setMasterValue_(state, rec, 'Owner', p ? p.owner : '');

    if (isClosedStatus_(status)) {
      if (!getMasterValue_(state, rec, 'Resolved on')) {
        setMasterValue_(state, rec, 'Resolved on', today);
        stats.closures.push({
          ref: rec.ref,
          project: projectName,
          suggestion: suggestion || details.substr(0, 80),
          status: status,
          note: getMasterValue_(state, rec, 'Note'),
          submittedBy: getMasterValue_(state, rec, 'Submitted by')
        });
      }
    } else if (getMasterValue_(state, rec, 'Resolved on')) {
      // Reopened. Clear the stamp so closing it again notifies properly.
      setMasterValue_(state, rec, 'Resolved on', '');
    }
  });
}

// ---------- Committing ----------

/**
 * Writes only the columns that actually changed, one setValues each, then
 * appends new rows in a single block. Keeps the window in which a human edit
 * could be clobbered as small as it can be.
 */
function commitMaster_(master, state, stats) {
  var existing = state.rows;
  var width = state.width;

  if (existing.length) {
    var dirtyCols = {};
    existing.forEach(function (rec) {
      if (!rec.dirty) return;
      for (var c = 0; c < width; c++) dirtyCols[c] = true;
    });

    // Narrow it: only columns whose value differs from what is on the sheet.
    var current = master.getRange(state.table.firstDataRow, 1, existing.length, width).getValues();
    Object.keys(dirtyCols).forEach(function (cStr) {
      var c = Number(cStr);
      var col = [], differs = false;
      for (var r = 0; r < existing.length; r++) {
        var v = existing[r].values[c];
        col.push([v === undefined ? '' : v]);
        var a = current[r][c], b = v;
        var as = (a instanceof Date) ? fmtDate_(a) : String(a === null || a === undefined ? '' : a);
        var bs = (b instanceof Date) ? fmtDate_(b) : String(b === null || b === undefined ? '' : b);
        if (as !== bs) differs = true;
      }
      if (differs) master.getRange(state.table.firstDataRow, c + 1, existing.length, 1).setValues(col);
    });
  }

  if (state.added.length) {
    var block = state.added.map(function (rec) {
      var row = rec.values.slice(0, width);
      while (row.length < width) row.push('');
      return row;
    });
    var startRow = Math.max(master.getLastRow() + 1, state.table.firstDataRow);
    if (master.getMaxRows() < startRow + block.length - 1) {
      master.insertRowsAfter(master.getMaxRows(), startRow + block.length - 1 - master.getMaxRows());
    }
    master.getRange(startRow, 1, block.length, width).setValues(block);
  }
}

// ---------- Writeback ----------

/**
 * The routing decision for one row (RFC-001): which project file, if any, a
 * suggestion should be written into, and why.
 *
 * Routing is by PROJECT, not by Origin: `Origin` records where a suggestion
 * was raised, but a suggestion belongs in a project's own file whenever that
 * project has one, regardless of where it started life. A row raised
 * centrally has never been "seen in" a project file, so routing off
 * `sourceFileId`/`Origin` alone silently drops it — that was the 8 Sep bug's
 * sibling. `byName` (built from `projects`, already resolved by
 * `readProjects_`, C3) is the source of truth for where a project's file
 * lives; a project with no spreadsheet (a Drive folder, or nothing built
 * yet — C6) is skipped, keeping the master tab as its home. Matching is
 * case-insensitive because the master's `Project` column is free text.
 *
 * @return {{fileId: string, reason: string}} reason is one of:
 *   'no-project' — project not in the tracker
 *   'no-file'    — project is a Drive folder / nothing built
 *   'source'     — seen in a project file this run
 *   'project'    — raised centrally, routed by the tracker
 */
function deliveryTarget_(projectName, sourceFileId, byName) {
  var p = byName[String(projectName).toLowerCase()];
  if (!p) return { fileId: '', reason: 'no-project' };
  if (!p.fileId) return { fileId: '', reason: 'no-file' };
  // Prefer sourceFileId: it's where this row was actually seen this run.
  if (sourceFileId) return { fileId: sourceFileId, reason: 'source' };
  return { fileId: p.fileId, reason: 'project' };
}

/**
 * Pushes Status, Assignee, Waiting on, Note, Resolved on, Ref and Owner back
 * into each project's own Suggestions tab, so the person who raised it sees
 * the answer exactly where they raised it — and Dan never sends a status email.
 *
 * Routing is delegated to `deliveryTarget_` — see its docstring for why it
 * does not read `Origin`.
 */
function writeBackAll_(master, state, stats, settings, projects) {
  var byName = {};
  projects.forEach(function (p) { byName[p.name.toLowerCase()] = p; });

  var byFile = {};
  state.rows.concat(state.added).forEach(function (rec) {
    if (rec.blank || !rec.ref) return;
    var target = deliveryTarget_(getMasterValue_(state, rec, 'Project'), rec._sourceFileId, byName);
    if (!target.fileId) return;
    var fileId = target.fileId;
    var p = byName[String(getMasterValue_(state, rec, 'Project')).toLowerCase()];
    if (!byFile[fileId]) byFile[fileId] = { project: rec._project || p, recs: [] };
    byFile[fileId].recs.push(rec);
  });

  var deliveryMode = String(settings.central_delivery || 'dry-run').toLowerCase();

  var fingerprints = {};

  Object.keys(byFile).forEach(function (fileId) {
    var entry = byFile[fileId];
    try {
      var ss  = withRetry_('writeback-open', function () { return SpreadsheetApp.openById(fileId); }, 2, 500);
      var tab = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
      if (!tab) return;

      var t = readTable_(tab);

      // Header row only, no headers at all: a tab we cannot address by name is a
      // tab we must not write into.
      if (!t.headers.length) return;

      var rowOfRef = {};
      t.rows.forEach(function (row, i) {
        var ref = String(cell_(t, row, 'Ref')).trim();
        if (ref) rowOfRef[ref] = i;
      });

      // The per-column update pass only makes sense when there is something to
      // update. It must NOT gate the delivery pass below: a project whose tab is
      // still empty is precisely the case RFC-001 exists to fix — Timetable had
      // four suggestions in the master and zero rows in its own file.
      if (t.rows.length) writebackColumns_().forEach(function (name) {
        var col = colNum_(t, name);
        if (!col) return;

        var current = tab.getRange(t.firstDataRow, col, t.rows.length, 1).getValues();
        var changed = false;

        entry.recs.forEach(function (rec) {
          var i = rowOfRef[rec.ref];
          if (i === undefined) return;
          var want = getMasterValue_(state, rec, name);
          var have = current[i][0];
          var hs = (have instanceof Date) ? fmtDate_(have) : String(have === null || have === undefined ? '' : have).trim();
          if (hs !== String(want)) { current[i][0] = want; changed = true; }
        });

        if (changed) {
          tab.getRange(t.firstDataRow, col, t.rows.length, 1).setValues(current);
          stats.writtenBack++;
        }
      });

      // ---- Upsert: rows raised centrally (or anywhere) that this project's
      // own tab has never seen. Insert instead of skip (T-102). Gated by
      // central_delivery: 'off' never delivers, 'dry-run' (default) reports
      // what would be delivered without writing, 'on' actually inserts.
      if (deliveryMode !== 'off') {
        var toDeliver = entry.recs.filter(function (rec) { return rowOfRef[rec.ref] === undefined; });

        if (toDeliver.length) {
          toDeliver.forEach(function (rec) {
            stats.delivered.push({
              ref: rec.ref,
              project: (entry.project && entry.project.name) || '',
              dryRun: deliveryMode === 'dry-run'
            });
          });

          if (deliveryMode === 'on') {
            var width = Math.max(t.headers.length, 1);
            // Align to the PROJECT TAB's actual headers, by name — never by
            // canonical column order. Project tabs currently have 12 columns
            // (no "Needed by"); a positional write is what misaligned a row
            // on 8 Sep (see seedOpenThreads in Migrate.js for the same fix).
            var byKey = {};
            t.headers.forEach(function (h, i) {
              var k = normalizeKey_(h);
              if (k && byKey[k] === undefined) byKey[k] = i;
            });

            var block = toDeliver.map(function (rec) {
              var out = new Array(width).fill('');
              // Only columns a project tab carries and the master can supply.
              // `Project` and `Origin` are master-only and deliberately omitted
              // because suggestionColumns_() (unlike masterSuggestionColumns_())
              // does not include them.
              suggestionColumns_().forEach(function (c) {
                var idx = byKey[normalizeKey_(c.name)];
                if (idx === undefined) return;   // this tab lacks the column
                out[idx] = getMasterValue_(state, rec, c.name);
              });
              return out;
            });

            var startRow = Math.max(tab.getLastRow() + 1, t.firstDataRow);
            if (tab.getMaxRows() < startRow + block.length - 1) {
              tab.insertRowsAfter(tab.getMaxRows(), startRow + block.length - 1 - tab.getMaxRows());
            }
            tab.getRange(startRow, 1, block.length, width).setValues(block);   // one write for the whole block

            // So the fingerprint pass below stamps these too — otherwise the
            // next sync reads a brand-new row as a human edit and pulls it
            // straight back into the master (RFC-001 safety note).
            toDeliver.forEach(function (rec) { rowOfRef[rec.ref] = true; });
          }
        }
      }

      // Record what this file now holds, so the next run can tell a human edit
      // from our own write. Only for rows we actually reached.
      entry.recs.forEach(function (rec) {
        if (rowOfRef[rec.ref] === undefined) return;
        var fp = {};
        columnsOwnedBy_(suggestionColumns_(), 'master').forEach(function (name) {
          fp[name] = shortHash_(getMasterValue_(state, rec, name));
        });
        fingerprints[rec.ref] = buildFingerprint_(fp);
      });

    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      var name = (entry.project && entry.project.name) || fileId;
      var f = recordFailure_('writeback:' + name, msg);
      if (f.shouldAlert) {
        opsAlert_(opsKeyForGroup_(entry.project && entry.project.group), '⚠️ Cannot write answers back to ' + name, [
          ['Project', name],
          ['Effect', 'Staff there will not see status updates in their own file. The master tracker is still correct.'],
          ['Error', msg]
        ], { signature: 'writeback|' + name + '|' + msg.substr(0, 60) });
      }
    }
  });

  persistFingerprints_(master, fingerprints);
}

/**
 * Writes the `Pushed` column in one pass, matched by Ref. Re-reads the master
 * because commitMaster_ has already appended any new rows and this needs their
 * final positions.
 */
function persistFingerprints_(master, fps) {
  if (!fps || !Object.keys(fps).length) return;
  var t = readTable_(master);
  var col = colNum_(t, 'Pushed');
  if (!col || !t.rows.length) return;

  var current = master.getRange(t.firstDataRow, col, t.rows.length, 1).getValues();
  var changed = false;
  t.rows.forEach(function (r, i) {
    var ref = String(cell_(t, r, 'Ref')).trim();
    if (!ref || fps[ref] === undefined) return;
    if (String(current[i][0]) !== fps[ref]) { current[i][0] = fps[ref]; changed = true; }
  });
  if (changed) master.getRange(t.firstDataRow, col, t.rows.length, 1).setValues(current);
}

// ---------- Archive sweep ----------

/**
 * Anything closed for longer than archive_after_days moves to the Archive tab.
 * Keeps the live tab at a few hundred rows so the app payload stays flat as
 * suggestions accumulate over years (§4.7).
 */
function archiveSweep_(ss, settings) {
  var master  = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
  var archive = ss.getSheetByName(CONFIG.TAB.ARCHIVE);
  if (!master || !archive) return 0;

  var t = readTable_(master);
  if (!t.rows.length) return 0;

  var cutoff = settings.archive_after_days || 60;
  var move = [], moveRows = [];

  t.rows.forEach(function (row, i) {
    if (isBlankRow_(row)) return;
    var status = str_(t, row, 'Status');
    if (!isClosedStatus_(status)) return;
    var resolved = cell_(t, row, 'Resolved on');
    var age = daysSince_(resolved);
    if (age === null || age < cutoff) return;
    move.push(row.slice());
    moveRows.push(t.firstDataRow + i);
  });

  if (!move.length) return 0;

  var aw = Math.max(readTable_(archive).headers.length, move[0].length);
  var block = move.map(function (r) {
    var row = r.slice(0, aw);
    while (row.length < aw) row.push('');
    return row;
  });
  archive.getRange(archive.getLastRow() + 1, 1, block.length, aw).setValues(block);

  // Delete bottom-up so earlier indices stay valid.
  moveRows.sort(function (a, b) { return b - a; }).forEach(function (r) { master.deleteRow(r); });

  audit_('Archive', '', '', move.length + ' closed items archived', 'closed for ' + cutoff + '+ days');
  return move.length;
}

// ---------- Nightly backup ----------

/** A dated copy of the master, with old copies pruned. Non-negotiable #10. */
function nightlyBackup() {
  return guarded_('nightlyBackup', function () {
    var s = getSettings_();
    if (!s.backup_enabled) return 'Backups are switched off in Config.';

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Scope both the folder and the file name to THIS tracker. DriveApp searches
    // the whole Drive of the effective user, so one person running two schools'
    // trackers from one account would otherwise have school 2 find school 1's
    // backup of the same name, conclude "already done", and silently never back
    // itself up again.
    var label = (getSettings_().school_name || ss.getName() || 'Projects Tracker').trim();
    var folderName = label + ' — Projects Tracker backups';
    var parents = DriveApp.getFoldersByName(folderName);
    var folder = parents.hasNext() ? parents.next() : DriveApp.createFolder(folderName);

    var name = label + ' Projects Tracker ' + todayStr_();
    var existing = folder.getFilesByName(name);
    if (existing.hasNext()) return 'Today’s backup already exists.';

    DriveApp.getFileById(ss.getId()).makeCopy(name, folder);

    var retain = s.backup_retention_days || 30;
    var cutoff = new Date(Date.now() - retain * 86400000);
    var files = folder.getFiles(), pruned = 0;
    while (files.hasNext()) {
      var f = files.next();
      if (f.getDateCreated() < cutoff) { f.setTrashed(true); pruned++; }
    }

    audit_('Backup', '', '', 'Nightly backup created', name + (pruned ? ' · ' + pruned + ' old copies pruned' : ''));
    return 'Backed up as "' + name + '"' + (pruned ? ', pruned ' + pruned + ' old copies.' : '.');
  });
}

// ---------- Small helpers ----------

function safeJson_(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function lastSyncSummary_() {
  return safeJson_(PropertiesService.getScriptProperties().getProperty('LAST_SYNC_SUMMARY'), null);
}
