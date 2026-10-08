/**
 * Triggers.gs — the "set it and forget it" automation.
 *
 * installTriggers() (run once, or via Fleet menu) schedules everything:
 *   ~1am  nightly  — rebuild the dashboard          (rebuildAnalytics)
 *   ~2am  nightly  — back the spreadsheet up        (nightlyBackup)
 *   ~7am  daily    — morning checks email           (morningChecks)
 *   ~8am  Mondays  — weekly digest email            (weeklyDigest)
 *   ~6am  1st/month— last month's report email      (monthlyReport)
 *
 * Safe to run again — old copies of our triggers are cleared first.
 */

function installTriggers() {
  const HANDLERS = ['rebuildAnalytics', 'checkDocumentExpiry', 'morningChecks',
                    'weeklyDigest', 'monthlyReport', 'nightlyBackup'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (HANDLERS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('rebuildAnalytics').timeBased().everyDays(1).atHour(1).create();
  ScriptApp.newTrigger('nightlyBackup').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('morningChecks').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('weeklyDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  ScriptApp.newTrigger('monthlyReport').timeBased().onMonthDay(1).atHour(6).create();

  SpreadsheetApp.getUi().alert('Automation is on',
    'Now running by itself:\n\n' +
    '• Nightly — dashboard refresh and a backup copy in Drive\n' +
    '• Every morning — one email if anything needs attention\n' +
    '  (documents, licences, service due, missing entries, odd readings)\n' +
    '• Monday morning — weekly digest email\n' +
    '• 1st of the month — last month\'s report email\n\n' +
    'Tip: set alert_email and fuel_price_per_litre on the Settings tab.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Old name kept so any existing trigger or bookmark still works. */
function checkDocumentExpiry() { morningChecks(); }
