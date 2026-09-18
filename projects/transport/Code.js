/**
 * Code.gs — serves the web app and adds the "Fleet" menu inside the Sheet.
 */

/** Serve the pastel web app. ?v=V003 (from a bus's QR sticker) pre-selects that vehicle. */
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.presetVehicle = (e && e.parameter && e.parameter.v) ? String(e.parameter.v) : '';
  return t
    .evaluate()
    .setTitle(getSetting_('app_title', 'Fleet Tracker'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://ssl.gstatic.com/docs/script/images/favicon.png');
}

/** Lets one HTML file pull in another (Styles, Script, partials). */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Adds a friendly menu every time the Sheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚌 Fleet')
    .addItem('1) Set up workbook', 'setupWorkbook')
    .addItem('2) Set / change admin PIN', 'setAdminPin')
    .addSeparator()
    .addItem('Rebuild dashboard now', 'rebuildAnalytics')
    .addItem('Fuel report — last month', 'menuFuelReportLastMonth')
    .addItem('Run morning checks now', 'morningChecks')
    .addItem('Send weekly digest now', 'weeklyDigest')
    .addItem('Send monthly report now', 'monthlyReport')
    .addItem('Back up now', 'nightlyBackup')
    .addSeparator()
    .addItem('Turn on automatic updates', 'installTriggers')
    .addItem('Show web app link', 'showWebAppLink')
    .addToUi();
}

/**
 * Build last month's Fuel Process report from the Sheet menu.
 * Same report as the app's Dashboard button, for anyone who would rather work
 * in the spreadsheet — the PDF lands in Drive and the link is shown here.
 */
function menuFuelReportLastMonth() {
  const ui = SpreadsheetApp.getUi();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  const token = menuToken_();
  const res = generateFuelReport(token,
    Utilities.formatDate(from, TZ_(), 'yyyy-MM-dd'),
    Utilities.formatDate(to, TZ_(), 'yyyy-MM-dd'));
  releaseMenuToken_(token);
  if (res && res.ok) ui.alert('Fuel report ready', res.message + '\n\n' + res.driveUrl, ui.ButtonSet.OK);
  else ui.alert('Could not build the report', (res && res.error) || 'Unknown error', ui.ButtonSet.OK);
}

/**
 * A short-lived admin token for menu actions.
 * Anyone running a menu item already has edit access to the spreadsheet, which
 * is a stronger check than the PIN — but the report functions all gate on a
 * token, so mint one rather than punching a hole in that rule.
 */
function menuToken_() {
  const token = Utilities.getUuid().replace(/-/g, '');
  const who = (Session.getEffectiveUser().getEmail() || 'Sheet menu').split('@')[0];
  CacheService.getScriptCache().put('atk_' + token, who, 300);
  return token;
}
function releaseMenuToken_(token) {
  try { CacheService.getScriptCache().remove('atk_' + token); } catch (e) {}
}

/** Shows the deployed web-app URL in a popup so it is easy to copy/share. */
function showWebAppLink() {
  const ui = SpreadsheetApp.getUi();
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  if (!url) {
    ui.alert('No web app yet',
      'Deploy it first: Deploy → New deployment → Web app → Deploy. Then run this again.',
      ui.ButtonSet.OK);
    return;
  }
  ui.alert('Your Fleet app link', url + '\n\nOpen it on your phone and add it to your home screen.', ui.ButtonSet.OK);
}
