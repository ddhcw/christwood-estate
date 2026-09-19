/**
 * Christwood ICT — Projects Tracker
 * Config.js — structural constants + the editable Config tab.
 *
 * Split rule:
 *   CONFIG (here)  = structural. Changing it changes the schema or breaks code.
 *   Config tab     = tunable. Dan or a lead changes it without touching code.
 *   Script Props   = secret. Webhook URLs only. Never the sheet (staff can read
 *                    every tab, even protected ones).
 *
 * Nothing in this file may reference a const declared in another file — GAS
 * evaluates top-level statements in filename order and cross-file refs break.
 */

var CONFIG = {
  TIMEZONE: 'Asia/Kolkata',

  TAB: {
    TRACKER:     'Sheet1',        // resolved defensively; see resolveTrackerSheet_()
    SUGGESTIONS: 'Suggestions',
    ARCHIVE:     'Archive',
    STAFF:       'Staff',
    CONFIG:      'Config',
    WEBHOOKS:    'Webhooks',
    AUDIT:       'Audit Log'
  },

  CACHE: {
    BOOTSTRAP:     'TRACKER_BOOTSTRAP_V4',
    BOOTSTRAP_TTL: 300,
    SETTINGS:      'TRACKER_SETTINGS_V4',
    SETTINGS_TTL:  300
  },

  /** Status vocabulary. Deliberately includes both "Won't do" (declined) and
   *  "Not an issue" (invalid) — the team invented the second one and it means
   *  something different. See SUGGESTIONS_SYSTEM.md §4.3. */
  STATUS: {
    NEW:          'New',
    ACCEPTED:     'Accepted',
    IN_PROGRESS:  'In progress',
    DONE:         'Done',
    WONT_DO:      "Won't do",
    NOT_AN_ISSUE: 'Not an issue'
  },

  /**
   * Item types. Bug/Addition/Improvement are the staff's own vocabulary, kept
   * as-is. Request is the fourth: the school changed and the system has to
   * follow — a section rename, a revised admission-number format, a new form
   * layout. It is deliberately separate from Improvement because a Request
   * CANNOT BE DECLINED. "Won't do, and here's why" is a healthy answer to an
   * Improvement; it is not an available answer when the grades got renamed.
   * Thread is Dan's own live build threads (SUGGESTIONS_SYSTEM.md §8).
   */
  TYPES: ['Bug', 'Addition', 'Improvement', 'Request', 'Thread'],

  /** Script Property prefix for Chat webhook URLs. */
  WEBHOOK_PREFIX: 'WEBHOOK_',

  /** Bail out of the sync this far into the 6-minute limit and resume next run. */
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,

  /** Cells that mean "there is no file here". Compared case-insensitively. */
  EMPTY_TOKENS: ['', 'n/a', 'na', 'nil', 'none', 'no web app', 'no sheet',
                 '<to be filled>', 'to be filled', '-', '—', 'tbd', 'not yet']
};

CONFIG.STATUS_ALL = [
  CONFIG.STATUS.NEW, CONFIG.STATUS.ACCEPTED, CONFIG.STATUS.IN_PROGRESS,
  CONFIG.STATUS.DONE, CONFIG.STATUS.WONT_DO, CONFIG.STATUS.NOT_AN_ISSUE
];
CONFIG.STATUS_OPEN   = [CONFIG.STATUS.NEW, CONFIG.STATUS.ACCEPTED, CONFIG.STATUS.IN_PROGRESS];
CONFIG.STATUS_CLOSED = [CONFIG.STATUS.DONE, CONFIG.STATUS.WONT_DO, CONFIG.STATUS.NOT_AN_ISSUE];

/**
 * Config tab defaults: key, value, type, and the explanation that sits in the
 * sheet next to it. Setup writes any missing row; it never overwrites a value
 * Dan has already changed.
 */
var CONFIG_DEFAULTS = [
  ['school_name',             'Christwood School', 'text', 'Used in the app title, Chat card subtitles, staff emails and the backup folder name. Set this FIRST when standing this up at a new school.'],
  ['team_name',               'ICT',      'text',    'The team that owns these systems. Appears in staff-facing copy: "ICT fills the grey columns".'],
  ['sync_enabled',            'TRUE',     'boolean', 'Master switch. FALSE pauses the nightly sync without deleting the trigger.'],
  ['archive_after_days',      '60',       'number',  'Move closed items to the Archive tab this many days after they closed.'],
  ['stale_new_days',          '14',       'number',  'An item still at "New" after this many days is flagged stale.'],
  ['notify_raiser_on_close',  'TRUE',     'boolean', 'Email the person who raised an item when it reaches a closed status. One email per person per sync, never one per item.'],
  ['weekly_digest_enabled',   'TRUE',     'boolean', 'Post the weekly summary card to each group Chat space.'],
  ['weekly_digest_day',       'Monday',   'text',    'Day the weekly digest posts.'],
  ['weekly_digest_hour',      '8',        'number',  'Hour (0-23, Asia/Kolkata) the weekly digest posts.'],
  ['digest_quiet_when_empty', 'TRUE',     'boolean', 'Skip the digest entirely for a group with nothing open. Prevents "all clear" noise.'],
  ['alert_after_failures',    '2',        'number',  'Only raise an Ops Alert after this many CONSECUTIVE failures for the same project. One flaky night stays silent.'],
  ['alert_cooldown_hours',    '6',        'number',  'Do not re-alert the same project + same error within this window.'],
  ['max_alerts_per_run',      '3',        'number',  'Hard ceiling on Ops Alerts from one sync run. Beyond this, one rolled-up "N more failing" message.'],
  ['writeback_enabled',       'TRUE',     'boolean', 'Write Ref/Status/Note back down into each project’s own Suggestions tab, so the raiser sees the answer where they raised it.'],
  ['central_delivery',        'dry-run',  'text',    'Gates delivering centrally-raised suggestions into a project’s own Suggestions tab (RFC-001). off = today’s behaviour, nothing new delivered. dry-run (default) = log/audit what would be delivered, write nothing. on = deliver. Never affects updates to rows already present in a project file.'],
  ['backup_enabled',          'TRUE',     'boolean', 'Nightly dated copy of this tracker into a Drive backup folder.'],
  ['backup_retention_days',   '30',       'number',  'Delete dated backups older than this.']
];

/**
 * Reads the Config tab into a plain object, cached for 5 minutes.
 * Falls back to CONFIG_DEFAULTS for any key the sheet is missing, so a
 * half-set-up sheet still runs.
 */
function getSettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CONFIG.CACHE.SETTINGS);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* rebuild */ }
  }

  var settings = {};
  CONFIG_DEFAULTS.forEach(function (d) { settings[d[0]] = coerceSetting_(d[1], d[2]); });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TAB.CONFIG);
  if (sheet && sheet.getLastRow() > 1) {
    var typeOf = {};
    CONFIG_DEFAULTS.forEach(function (d) { typeOf[d[0]] = d[2]; });

    var t = readTable_(sheet);
    t.rows.forEach(function (row) {
      var key = String(cell_(t, row, 'Setting')).trim();
      if (!key) return;
      settings[key] = coerceSetting_(cell_(t, row, 'Value'), typeOf[key] || 'text');
    });
  }

  cache.put(CONFIG.CACHE.SETTINGS, JSON.stringify(settings), CONFIG.CACHE.SETTINGS_TTL);
  return settings;
}

function coerceSetting_(raw, type) {
  var v = (raw === null || raw === undefined) ? '' : String(raw).trim();
  if (type === 'boolean') return /^(true|yes|y|1|on)$/i.test(v);
  if (type === 'number')  { var n = Number(v); return isNaN(n) ? 0 : n; }
  return v;
}

/**
 * The organisation label used in every staff-facing string: page title, Chat
 * card subtitles, email footers, backup folder. Driven by the Config tab so a
 * fork does not ship another school a product branded "Christwood".
 */
function orgLabel_() {
  var s = getSettings_();
  return [String(s.school_name || '').trim(), String(s.team_name || '').trim()]
    .filter(String).join(' ') || 'Projects Tracker';
}

/** Just the team, for "ICT fills the grey columns" style copy. */
function teamLabel_() {
  return String(getSettings_().team_name || 'ICT').trim() || 'ICT';
}

function appTitle_() { return orgLabel_() + ' — Projects Tracker'; }

function clearSettingsCache_() {
  CacheService.getScriptCache().remove(CONFIG.CACHE.SETTINGS);
}

/**
 * Webhook URL for a key, from Script Properties. Returns '' when unset —
 * every caller must treat that as "this channel is switched off", not an error.
 */
function getWebhook_(key) {
  if (!key) return '';
  var v = PropertiesService.getScriptProperties()
    .getProperty(CONFIG.WEBHOOK_PREFIX + slugKey_(key));
  return v ? String(v).trim() : '';
}

function setWebhook_(key, url) {
  var props = PropertiesService.getScriptProperties();
  var name = CONFIG.WEBHOOK_PREFIX + slugKey_(key);
  if (!url) props.deleteProperty(name);
  else props.setProperty(name, String(url).trim());
}

function slugKey_(s) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
