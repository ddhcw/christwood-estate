/**
 * Christwood ICT — Projects Tracker
 * Schema.js — the single definition of every column, in every tab, everywhere.
 *
 * Why this file exists: with 21 project files and growing, the failure mode is
 * column drift — three vocabularies for one concept (SUGGESTIONS_SYSTEM.md §3.1).
 * Master tab, project tabs and the installer all build from these arrays, so
 * they cannot disagree.
 *
 * Column ownership is what makes the two-way sync safe:
 *   owner:'project' — staff type it in their own file; master never overwrites.
 *   owner:'master'  — Dan and the leads set it; pushed DOWN into project files.
 *   owner:'sync'    — stamped by machinery; nobody types it.
 */

/** Columns present in a project's own Suggestions tab, in order. */
function suggestionColumns_() {
  return [
    { name: 'Ref',          owner: 'sync',    width: 90,  note: 'Auto ID. Do not edit or delete — it is how your row stays linked to the master tracker.' },
    { name: 'Type',         owner: 'project', width: 110, note: 'Bug / Addition / Improvement.' },
    { name: 'Suggestion',   owner: 'project', width: 300, note: 'One line. The headline.' },
    { name: 'Details',      owner: 'project', width: 380, note: 'The longer explanation — what happens now, what should happen.' },
    { name: 'Submitted by', owner: 'project', width: 140, note: 'Your name.' },
    { name: 'Raised on',    owner: 'sync',    width: 100, note: 'Stamped automatically the first time this row is picked up.' },
    { name: 'Status',       owner: 'master',  width: 120, note: 'Set by ' + teamLabel_() + '. Read-only here.' },
    { name: 'Assignee',     owner: 'master',  width: 130, note: 'Who is doing it. Set by ' + teamLabel_() + '.' },
    { name: 'Waiting on',   owner: 'master',  width: 130, note: 'If this is blocked, who it is blocked on.' },
    { name: 'Needed by',    owner: 'master',  width: 100, note: 'Only for Requests with a real outside deadline — the term starts, the new format goes live. Set by ' + teamLabel_() + '. Leave blank when there is no date; a made-up deadline is worse than none.' },
    { name: 'Note',         owner: 'master',  width: 300, note: 'The reply from ' + teamLabel_() + ' — especially the reason when something is declined.' },
    { name: 'Resolved on',  owner: 'sync',    width: 100, note: 'Stamped automatically when the status becomes final.' },
    { name: 'Owner',        owner: 'sync',    width: 130, note: 'Whoever owns this project. Inherited automatically.' }
  ];
}

/**
 * Master Suggestions tab = the project schema, plus the two columns that only
 * make sense once everything is in one place.
 * `Project` must be first: it is the column Dan sorts and filters by.
 */
function masterSuggestionColumns_() {
  var cols = suggestionColumns_();
  var project = { name: 'Project', owner: 'project', width: 200, note: 'Which system this is about. Pick from the dropdown.' };
  var origin  = { name: 'Origin',  owner: 'sync',    width: 90,  note: 'Master = raised here. Otherwise the project file it was pulled from.' };
  var pushed  = { name: 'Pushed',  owner: 'sync',    width: 150, note: 'Machinery — do not edit or clear. A fingerprint of what the sync last wrote down into the project file, so it can tell a human edit there apart from its own. Clearing it makes the next sync treat any difference as a human edit.' };
  return [project].concat(cols).concat([origin, pushed]);
}

/** Tracker (main) tab. Existing columns kept; Owner + Contributors are the §4.5 split. */
function trackerColumns_() {
  return [
    { name: 'Name',                            width: 220 },
    { name: 'Details (What It Automates)',     width: 340 },
    { name: 'Link to Google Sheet(s)',         width: 170 },
    { name: 'Link to GAS Web App',             width: 170 },
    { name: 'Owner',                           width: 150 },
    { name: 'Contributors',                    width: 180 },
    { name: 'Current Status',                  width: 140 },
    { name: 'Other Costs (Hardware/Software)', width: 190 },
    { name: 'Responsible Group',               width: 170 },
    { name: 'Documentation/Instructions Link', width: 180 }
  ];
}

function staffColumns_() {
  return [
    { name: 'Name',    width: 160, note: 'Canonical name. This is what appears in every dropdown.' },
    { name: 'Email',   width: 220, note: 'Used to tell them when something they raised is resolved.' },
    { name: 'Role',    width: 150, note: 'THIS IS A SECURITY CONTROL. A role containing the whole word Lead, ICT or Admin keeps edit rights on every protected tab when Setup runs. Use: Lead, ICT, Teacher, Office. Do not write job titles like "Administrative Assistant" here.' },
    { name: 'Aliases', width: 200, note: 'Other spellings seen in the sheets, comma separated. e.g. "Monica Angel". Migration folds these into the canonical name.' },
    { name: 'Active',  width: 80,  note: 'FALSE removes them from dropdowns without losing their history.' }
  ];
}

function configColumns_() {
  return [
    { name: 'Setting',     width: 210 },
    { name: 'Value',       width: 130 },
    { name: 'What it does', width: 560 }
  ];
}

function webhookColumns_() {
  return [
    { name: 'Key',        width: 190, note: 'Used in code. Do not rename.' },
    { name: 'Channel',    width: 110, note: 'Ops = the single Ops Alerts space. Digest = that team’s own space.' },
    { name: 'Purpose',    width: 420 },
    { name: 'Configured', width: 110, note: 'Set by "Set a webhook URL…". URLs live in Script Properties, never in this sheet — staff can read every tab.' }
  ];
}

function auditColumns_() {
  return [
    { name: 'When',    width: 140 },
    { name: 'Action',  width: 180 },
    { name: 'Ref',     width: 90  },
    { name: 'Project', width: 180 },
    { name: 'Detail',  width: 480 },
    { name: 'By',      width: 160 }
  ];
}

// ---------- Helpers over the schema ----------

/**
 * Builds a row array from a record keyed by column name, substituting '' for
 * any column the record omits.
 *
 * Exists because `names.map(function (n) { return rec[n]; })` silently yields
 * `undefined` for a column added to the schema but not to the record — which
 * then reaches setValues(). Adding `Needed by` to suggestionColumns_() did
 * exactly that to two callers. Route every row build through here.
 */
function rowFromRecord_(cols, rec) {
  return columnNames_(cols).map(function (n) {
    var v = rec[n];
    return (v === undefined || v === null) ? '' : v;
  });
}

function columnNames_(cols) {
  return cols.map(function (c) { return c.name; });
}

function columnsOwnedBy_(cols, owner) {
  return cols.filter(function (c) { return c.owner === owner; }).map(function (c) { return c.name; });
}

/** Columns the master pushes back down into a project's own tab. */
function writebackColumns_() {
  return columnsOwnedBy_(suggestionColumns_(), 'master')
    .concat(columnsOwnedBy_(suggestionColumns_(), 'sync'));
}

/** Columns a project's own tab is the source of truth for. */
function projectOwnedColumns_() {
  return columnsOwnedBy_(suggestionColumns_(), 'project');
}

/**
 * Maps a legacy Suggestions tab onto the canonical schema.
 *
 * The Call Logs tab uses `Suggestion | Further Details | Submitted by | Status`
 * where `Suggestion` actually holds the TYPE ("Bug fix", "Improvements") and
 * `Further Details` holds the content. An earlier pass of Code.gs expected
 * `project | suggestion | suggestor | link`. Both are handled here.
 *
 * @return {Object|null} map of canonical name -> source header, or null if the
 *                       tab is already canonical.
 */
function detectLegacyMapping_(headers) {
  var keys = headers.map(normalizeKey_);
  var has = function (k) { return keys.indexOf(k) !== -1; };

  if (has('ref') && has('details') && has('raised_on')) return null;   // already canonical

  // Shape A — Call Logs: type hidden in "Suggestion", content in "Further Details".
  if (has('further_details')) {
    return {
      shape: 'call-logs',
      'Type':         'Suggestion',
      'Suggestion':   'Further Details',
      'Details':      'Further Details',
      'Submitted by': has('submitted_by') ? 'Submitted by' : (has('suggestor') ? 'Suggestor' : ''),
      'Status':       has('status') ? 'Status' : ''
    };
  }

  // Shape B — the old Code.gs assumption.
  if (has('suggestor') || (has('project') && has('suggestion') && !has('details'))) {
    return {
      shape: 'old-codegs',
      'Type':         '',
      'Suggestion':   'Suggestion',
      'Details':      has('link') ? 'Link' : '',
      'Submitted by': has('suggestor') ? 'Suggestor' : '',
      'Status':       has('status') ? 'Status' : ''
    };
  }

  // Shape C — anything with a Suggestion column and nothing else recognisable.
  if (has('suggestion')) {
    return {
      shape: 'minimal',
      'Type':         has('type') ? 'Type' : '',
      'Suggestion':   'Suggestion',
      'Details':      has('details') ? 'Details' : '',
      'Submitted by': has('submitted_by') ? 'Submitted by' : '',
      'Status':       has('status') ? 'Status' : ''
    };
  }

  return { shape: 'unknown' };
}

/**
 * Free-text type words -> the canonical vocabulary. Tested in order, most
 * specific first.
 *
 * Note that "change", "revision" and "rename" resolve to Request, not
 * Improvement: the school changing its own structure is not an enhancement to
 * our system, and treating it as one makes it look declinable when it is not.
 */
function normalizeType_(raw) {
  var s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/bug|fix|error|issue|broken|not work|defect|wrong/.test(s))      return 'Bug';
  if (/request|revis|renam|chang|amend|modif|adjust|update/.test(s))   return 'Request';
  if (/add|new|feature|extra|include/.test(s))                         return 'Addition';
  if (/improv|enhanc|better|tweak|simplif|faster|cleaner/.test(s))     return 'Improvement';
  if (/thread|build|blocked|waiting|design|scope/.test(s))             return 'Thread';
  return 'Improvement';   // the safest default: neither dismissed nor escalated
}

/**
 * Free-text status -> the canonical vocabulary, plus any date baked into it.
 * Anything unrecognised becomes 'New' and the original text is preserved so
 * migration never silently discards what someone wrote.
 *
 * @return {{status:string, resolvedOn:string, residue:string}}
 */
function normalizeStatus_(raw) {
  var s = String(raw || '').trim();
  if (!s) return { status: CONFIG.STATUS.NEW, resolvedOn: '', residue: '' };

  var low = s.toLowerCase();
  var date = extractDateFromText_(s);
  var result = function (status, keepText) {
    return { status: status, resolvedOn: date, residue: keepText ? s : '' };
  };

  if (/not an issue|no issue|non.?issue|invalid|works as|by design/.test(low)) return result(CONFIG.STATUS.NOT_AN_ISSUE, false);
  if (/won'?t do|wont do|declin|reject|dropp?ed|not doing|no thanks/.test(low)) return result(CONFIG.STATUS.WONT_DO, false);
  if (/complete|done|fixed|resolved|closed|implemented|live/.test(low))        return result(CONFIG.STATUS.DONE, false);
  if (/in progress|wip|working|started|ongoing|doing/.test(low))               return { status: CONFIG.STATUS.IN_PROGRESS, resolvedOn: '', residue: '' };
  if (/accept|approv|agreed|planned|queued|to do|todo/.test(low))              return { status: CONFIG.STATUS.ACCEPTED, resolvedOn: '', residue: '' };
  if (/^new$|^open$|^pending$|^raised$/.test(low))                             return { status: CONFIG.STATUS.NEW, resolvedOn: '', residue: '' };

  // Unrecognised — treat as open, keep the words.
  return { status: CONFIG.STATUS.NEW, resolvedOn: '', residue: s };
}

function isClosedStatus_(status) {
  return CONFIG.STATUS_CLOSED.indexOf(String(status).trim()) !== -1;
}

function isOpenStatus_(status) {
  return CONFIG.STATUS_OPEN.indexOf(String(status).trim()) !== -1;
}

/** "To be managed by one person within the Academic Group." is a to-do, not data. */
function isOwnerPlaceholder_(v) {
  var s = String(v || '').trim();
  if (!s) return false;
  return /^to be (managed|decided|assigned|handled)/i.test(s) ||
         /within the .* group/i.test(s) ||
         /one person/i.test(s) ||
         /^tbd$/i.test(s) ||
         /^unassigned$/i.test(s);
}
