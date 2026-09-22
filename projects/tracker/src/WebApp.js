/**
 * Christwood ICT — Projects Tracker
 * WebApp.js — the read surface.
 *
 * The app is deployed anonymously (appsscript.json: ANYONE_ANONYMOUS), so
 * Session.getActiveUser() is empty and the page cannot know who is looking.
 * That settles the architecture: SHEETS ARE THE WRITE SURFACE, THE APP IS THE
 * READ SURFACE (C1/§4.1). There is deliberately no write endpoint here. Adding
 * one would make it anonymous and spammable.
 *
 * Everything is read from ONE spreadsheet. No cross-file reads at page load —
 * that work happens on the nightly trigger (C4).
 */

// ---------- doGet ----------

function doGet(e) {
  try {
    var snapshot = getSnapshot_();
    var template = HtmlService.createTemplateFromFile('Index');

    // Escaping "<" means embedded JSON can never close the <script> tag early.
    template.dataJson = JSON.stringify(snapshot).replace(/</g, '\\u003c');
    template.appTitle = appTitle_();

    return template.evaluate()
      .setTitle(appTitle_())
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (err) {
    var msg = (err && err.message) ? err.message : String(err);
    try {
      opsAlert_('OPS_SYNC', '⚠️ The tracker web app failed to load', [
        ['Error', msg], ['When', fmtDateTime_(new Date())]
      ], { signature: 'doGet|' + msg.substr(0, 60) });
    } catch (inner) {}

    // An honest error page beats a Google stack trace.
    return HtmlService.createHtmlOutput(
      '<div style="font-family:Inter,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:60px auto;' +
      'padding:28px;border:1px solid #E3E7EB;border-radius:14px;color:#1A1A1A">' +
      '<h2 style="color:#C0271F;margin:0 0 8px;font-size:18px">The tracker could not load</h2>' +
      '<p style="color:#5F6469;line-height:1.6">ICT has been told automatically. Nothing you did caused this, ' +
      'and nothing has been lost — the data lives in the tracker Sheet.</p>' +
      '<p style="color:#8A9096;font-size:12px;font-family:monospace">' + escapeForEmail_(msg) + '</p></div>'
    ).setTitle('Tracker unavailable');
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------- Endpoints (read-only, by design) ----------

/** Refresh button. Rebuilds the snapshot from the sheet, bypassing the cache. */
function getFreshData() {
  clearBootstrapCache_();
  return getSnapshot_();
}

/**
 * Closed items for one project, fetched on demand so the initial payload stays
 * flat as suggestions accumulate over years (§4.7).
 * The project name is validated against the tracker — an anonymous caller
 * cannot use this to read arbitrary rows.
 */
function getClosedForProject(projectName) {
  var wanted = String(projectName || '').trim().toLowerCase();
  if (!wanted) return [];

  var snap = getSnapshot_();
  var known = snap.projects.some(function (p) { return p.name.toLowerCase() === wanted; });
  if (!known) return [];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = [];

  [CONFIG.TAB.SUGGESTIONS, CONFIG.TAB.ARCHIVE].forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet || sheet.getLastRow() < 2) return;
    var t = readTable_(sheet);
    t.rows.forEach(function (r) {
      if (isBlankRow_(r)) return;
      if (str_(t, r, 'Project').toLowerCase() !== wanted) return;
      var status = str_(t, r, 'Status');
      if (!isClosedStatus_(status)) return;
      out.push({
        ref: str_(t, r, 'Ref'),
        type: str_(t, r, 'Type'),
        suggestion: str_(t, r, 'Suggestion'),
        details: truncate_(str_(t, r, 'Details'), 900),
        submittedBy: str_(t, r, 'Submitted by'),
        status: status,
        note: str_(t, r, 'Note'),
        raisedOn: str_(t, r, 'Raised on'),
        neededBy: str_(t, r, 'Needed by'),
        resolvedOn: str_(t, r, 'Resolved on'),
        archived: tabName === CONFIG.TAB.ARCHIVE
      });
    });
  });

  out.sort(function (a, b) { return String(b.resolvedOn).localeCompare(String(a.resolvedOn)); });
  return out;
}

// ---------- Snapshot ----------

/**
 * Automated Runs for the dashboard — read only, and deliberately stripped.
 *
 * The Approve and Rollback columns are NOT returned. The page is anonymous and
 * cannot know who is looking (see the note at the top of this file), so it must
 * not show an action only a Lead may take. Approval lives in the Sheet, in a
 * protected column. RFC-0003.
 */
function readRunsForSnapshot_(ss) {
  var sheet = ss.getSheetByName('Automated Runs');
  if (!sheet || sheet.getLastRow() < 2) return [];

  var t = readTable_(sheet), out = [];
  t.rows.forEach(function (r) {
    if (isBlankRow_(r)) return;
    out.push({
      date:       str_(t, r, 'Run date'),
      project:    str_(t, r, 'Project'),
      ref:        str_(t, r, 'Ref'),
      ticket:     str_(t, r, 'Ticket'),
      pr:         str_(t, r, 'PR'),
      prLink:     str_(t, r, 'PR link'),
      actions:    str_(t, r, 'Actions taken'),
      unverified: str_(t, r, 'Could not verify'),
      state:      str_(t, r, 'Deploy state') || 'Not ready',
      note:       str_(t, r, 'Deploy note')
    });
  });

  // Newest first — the thing you came to look at is the thing that just ran.
  out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return out;
}

function clearBootstrapCache_() {
  CacheService.getScriptCache().remove(CONFIG.CACHE.BOOTSTRAP);
}

function getSnapshot_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CONFIG.CACHE.BOOTSTRAP);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* rebuild */ }
  }
  var snap = buildSnapshot_();
  var json = JSON.stringify(snap);
  // CacheService caps a value at 100KB. Past that, rebuild each time rather
  // than fail silently — correctness beats the 200ms.
  if (json.length < 90000) cache.put(CONFIG.CACHE.BOOTSTRAP, json, CONFIG.CACHE.BOOTSTRAP_TTL);
  return snap;
}

/**
 * One spreadsheet, three tabs, one pass. Only OPEN items are embedded; closed
 * ones ship as a count and are fetched on demand.
 */
function buildSnapshot_() {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var tracker  = resolveTrackerSheet_(ss);
  var settings = getSettings_();
  var projects = readProjects_(tracker);

  var suggestTargets = safeJson_(
    PropertiesService.getScriptProperties().getProperty('SUGGEST_TARGETS'), {}) || {};
  var masterUrl = masterSheetUrl_();
  var masterSheet = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
  var masterFallback = '';
  if (masterSheet && masterUrl) {
    // Land them on the first empty row, cursor ready. A link that drops you at
    // row 1 of a 300-row tab is a link nobody follows twice.
    masterFallback = masterUrl.replace(/\/edit.*$/, '/edit') +
      '#gid=' + masterSheet.getSheetId() + '&range=A' + (masterSheet.getLastRow() + 1);
  }

  var byName = {};
  var out = projects.map(function (p) {
    var rec = {
      name: p.name,
      details: truncate_(p.details, 700),
      owner: p.owner,
      contributors: p.contributors,
      group: p.group,
      status: p.status,
      sheetUrl: p.resolvedSheetUrl || cleanUrl_(p.sheetUrl),
      appUrl: cleanUrl_(p.appUrl),
      docsUrl: cleanUrl_(p.docsUrl),
      costs: p.costs,
      hasOwnTab: !!suggestTargets[p.name],
      suggestUrl: suggestTargets[p.name] || masterFallback,
      items: [], openCount: 0, closedCount: 0, blockedCount: 0, staleCount: 0,
      overdueCount: 0
    };
    byName[p.name.toLowerCase()] = rec;
    return rec;
  });

  var items = [];
  var staleDays = settings.stale_new_days || 14;

  if (masterSheet && masterSheet.getLastRow() > 1) {
    var t = readTable_(masterSheet);
    t.rows.forEach(function (r) {
      if (isBlankRow_(r)) return;

      var projectName = str_(t, r, 'Project');
      var suggestion  = str_(t, r, 'Suggestion');
      var details     = str_(t, r, 'Details');
      if (!suggestion && !details) return;

      var status = str_(t, r, 'Status') || CONFIG.STATUS.NEW;
      var target = byName[projectName.toLowerCase()];

      if (isClosedStatus_(status)) {
        if (target) target.closedCount++;
        return;                                   // counts only (§4.7)
      }

      var raisedOn = str_(t, r, 'Raised on');
      var item = {
        ref:        str_(t, r, 'Ref'),
        project:    projectName,
        group:      target ? target.group : '',
        type:       str_(t, r, 'Type') || 'Improvement',
        suggestion: suggestion || truncate_(details, 110),
        details:    truncate_(details, 900),
        submittedBy: str_(t, r, 'Submitted by'),
        status:     status,
        assignee:   str_(t, r, 'Assignee'),
        owner:      str_(t, r, 'Owner'),
        waitingOn:  str_(t, r, 'Waiting on'),
        note:       str_(t, r, 'Note'),
        raisedOn:   raisedOn,
        ageDays:    daysSince_(raisedOn) || 0,
        ageLabel:   ageLabel_(raisedOn),
        neededBy:   str_(t, r, 'Needed by'),
        dueInDays:  dueInDays_(str_(t, r, 'Needed by')),
        dueLabel:   dueLabel_(str_(t, r, 'Needed by'))
      };
      item.overdue = (item.dueInDays !== null && item.dueInDays < 0);
      item.dueSoon = (item.dueInDays !== null && item.dueInDays >= 0 && item.dueInDays <= 7);
      item.stale = (status === CONFIG.STATUS.NEW && item.ageDays >= staleDays);
      // §5 guardrail: New for 14+ days on a project with nobody named is the
      // one that quietly dies. Flag it distinctly.
      item.orphaned = item.stale && !item.assignee && !item.owner;

      items.push(item);
      if (target) {
        target.items.push(item);
        target.openCount++;
        if (item.waitingOn) target.blockedCount++;
        if (item.stale) target.staleCount++;
        if (item.overdue) target.overdueCount++;
      }
    });
  }

  /**
   * Oldest first — but a deadline that has already passed outranks any amount
   * of age. "Raised 34 days ago" is pressure; "the term started and this is
   * still wrong" is a different category of problem, and burying it at position
   * 40 because it was raised yesterday would defeat the list.
   * Most overdue first, then everything else oldest first.
   */
  var byUrgency = function (a, b) {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.overdue && b.overdue) return a.dueInDays - b.dueInDays;
    return b.ageDays - a.ageDays;
  };
  items.sort(byUrgency);
  out.forEach(function (p) { p.items.sort(byUrgency); });

  var lastSync = lastSyncSummary_();
  var unassigned = out.filter(function (p) { return !p.owner; });

  return {
    appTitle: appTitle_(),
    orgLabel: orgLabel_(),
    teamLabel: teamLabel_(),
    generatedAt: fmtDateTime_(new Date()),
    generatedTime: fmtTime_(new Date()),
    lastSync: lastSync,
    lastSyncLabel: lastSync ? lastSync.at : 'never',
    lastSyncStale: lastSync ? (daysSince_(lastSync.at) >= 2) : true,
    staleDays: staleDays,
    projects: out,
    items: items,
    runs: readRunsForSnapshot_(ss),
    stats: {
      total:      out.length,
      launched:   out.filter(function (p) { return /launch(ed)?|live/i.test(p.status); }).length,
      building:   out.filter(function (p) { return /building|testing|launching/i.test(p.status); }).length,
      openItems:  items.length,
      blocked:    items.filter(function (i) { return i.waitingOn; }).length,
      stale:      items.filter(function (i) { return i.stale; }).length,
      overdue:    items.filter(function (i) { return i.overdue; }).length,
      dueSoon:    items.filter(function (i) { return i.dueSoon; }).length,
      unassigned: unassigned.length,
      unassignedLive: unassigned.filter(function (p) { return /launch(ed)?|live/i.test(p.status); })
                                .map(function (p) { return p.name; })
    }
  };
}

// ---------- Suggest deep links ----------

/**
 * Recorded during the sync (which already has each file open) so page load
 * never pays for it. Projects without their own tab fall back to the master.
 */
function rememberSuggestTarget_(projectName, spreadsheet, tab) {
  try {
    var props = PropertiesService.getScriptProperties();
    var map = safeJson_(props.getProperty('SUGGEST_TARGETS'), {}) || {};
    map[projectName] = spreadsheet.getUrl().replace(/\/edit.*$/, '/edit') + '#gid=' + tab.getSheetId();
    props.setProperty('SUGGEST_TARGETS', JSON.stringify(map));
  } catch (e) { /* a missing deep link is cosmetic */ }
}

function forgetSuggestTarget_(projectName) {
  try {
    var props = PropertiesService.getScriptProperties();
    var map = safeJson_(props.getProperty('SUGGEST_TARGETS'), {}) || {};
    if (map[projectName]) { delete map[projectName]; props.setProperty('SUGGEST_TARGETS', JSON.stringify(map)); }
  } catch (e) {}
}

// ---------- Small helpers ----------

function truncate_(s, n) {
  s = String(s || '');
  return s.length > n ? s.substr(0, n - 1) + '…' : s;
}

/** Returns '' for N/A, Nil, <To be filled> and anything that is not a link. */
function cleanUrl_(v) {
  if (isEmptyToken_(v)) return '';
  var s = String(v).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}
