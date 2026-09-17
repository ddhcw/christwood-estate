/**
 * ═══════════════════════════════════════════════════════════════
 * CHRISTWOOD PURCHASE REQUEST SYSTEM — Sheet Setup
 * ═══════════════════════════════════════════════════════════════
 * Run setupSheet() once to create all required tabs with their
 * headers, formatting, and default configuration values.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * Creates a custom menu in the spreadsheet for admin actions.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🛒 Purchase System')
    .addItem('🔧 Run Initial Setup', 'setupSheet')
    .addSeparator()
    .addItem('📋 View Web App URL', 'showWebAppUrl')
    .addToUi();
}
/**
 * Shows the deployed web app URL.
 */
function showWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  if (url) {
    SpreadsheetApp.getUi().alert('Web App URL:\n\n' + url);
  } else {
    SpreadsheetApp.getUi().alert(
      'The web app has not been deployed yet.\n\n' +
      'Go to Deploy → New deployment → Web app to deploy it.'
    );
  }
}
/**
 * Main setup function. Creates all required tabs.
 */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  createConfigTab_(ss);
  createImportHRTab_(ss);
  createRequestsTab_(ss);
  createItemsTab_(ss);
  SpreadsheetApp.flush();
  // Activate the Config tab
  var configSheet = ss.getSheetByName('Config');
  if (configSheet) {
    ss.setActiveSheet(configSheet);
  }
  SpreadsheetApp.getUi().alert(
    '✅ Setup Complete!\n\n' +
    '1. Fill in the Config tab with your settings\n' +
    '2. Paste your HR Database URL in the ImportHR tab (cell B2)\n' +
    '3. Deploy the web app: Deploy → New deployment → Web app\n' +
    '   - Execute as: Me\n' +
    '   - Access: Anyone within your organisation'
  );
}
// ─────────────────────────────────────────────────────────
// CONFIG TAB
// ─────────────────────────────────────────────────────────
/**
 * Creates and formats the Config tab.
 * @param {SpreadsheetApp.Spreadsheet} ss
 */
function createConfigTab_(ss) {
  var sheet = getOrCreateSheet_(ss, 'Config');
  sheet.clear();
  // Set column widths
  sheet.setColumnWidth(1, 260);  // A - Section headers
  sheet.setColumnWidth(2, 260);  // B - Setting keys
  sheet.setColumnWidth(3, 400);  // C - Values
  sheet.setColumnWidth(4, 360);  // D - Notes
  var data = [
    // Row 1 - Title
    ['PURCHASE REQUEST SYSTEM — CONFIGURATION', '', '', ''],
    // Row 2 - blank
    ['', '', '', ''],
    // Row 3 - Section header
    ['📝 Request Number Format', '', '', ''],
    // Row 4-8
    ['', 'Prefix', 'PR', 'Letters before the year code'],
    ['', 'Academic Year Code', '2627', 'e.g., 2627 for academic year 2026–27'],
    ['', 'Separator', '-', 'Character between year code and sequence number'],
    ['', 'Next Sequence Number', '1', '⚠️ Auto-incremented on each submission — do not edit unless resetting'],
    ['', 'Sequence Padding', '4', 'Number of digits (e.g., 4 → 0001)'],
    // Row 9 - blank
    ['', '', '', ''],
    // Row 10 - Section header
    ['📧 Email Notifications', '', '', ''],
    // Row 11-15
    ['', 'On Submission', '', 'Comma-separated email addresses to notify when a request is submitted'],
    ['', 'On Principal Approval', '', '(Future) Notify when Principal approves'],
    ['', 'On Admin Head Approval', '', 'Comma-separated email addresses — notifies the Admin Head (non-academic head) for approval when a request is submitted'],
    ['', 'On CEO Approval', '', 'Comma-separated email addresses — notifies the CEO for approval when a request is submitted'],
    ['', 'On Rejection', '', '(Future) Notify when a request is rejected'],
    // Row 16 - blank
    ['', '', '', ''],
    // Row 17 - Section header
    ['🏢 Department Roles & Access', '', '', ''],
    // Row 18 - Sub-headers
    ['', 'Department', 'Email IDs (comma-separated)', 'Access Level'],
    // Row 19-23 (unchanged content, shifted down by the new Admin Head row above)
    ['', 'Purchase', '', 'View + Print'],
    ['', 'HR', '', 'View + Print'],
    ['', 'Finance', '', 'View'],
    ['', 'Stock Keeping', '', 'View'],
    ['', 'Management', '', 'View'],
    // Row 24 - blank
    ['', '', '', ''],
    // Row 25 - Section header
    ['👤 Guest / Consultant Access', '', '', ''],
    // Row 26
    ['', 'Allowed Guest Emails', '', 'Comma-separated — these emails can submit requests without HR verification'],
    // Row 27 - blank
    ['', '', '', ''],
    // Row 28 - Section header
    ['⚙️ System Settings', '', '', ''],
    // Row 29-34
    ['', 'Attachment Folder ID', '', 'Optional: Specific Google Drive Folder ID to store attachments. If fully empty, will create automatically in parent directory.'],
    ['', 'Max File Size (MB)', '10', 'Maximum size per attachment in megabytes'],
    ['', 'Allowed File Types', 'pdf,jpg,jpeg,png', 'Comma-separated file extensions'],
    ['', 'School Name', 'Christwood', 'Displayed in print headers and notifications'],
    ['', 'School Logo URL', '', 'Optional: Google Drive link or public URL for the school logo on the print form.'],
    ['', 'Digital Signature Text', '{{email}} has submitted this purchase request digitally on {{date}}. This digital submission serves as the requestor\'s authorisation and attestation — no physical signature is required.', 'Use {{email}} and {{date}} as placeholders'],
    // Row 35 - blank
    ['', '', '', ''],
    // Row 36 - Section header
    ['📊 HR Column Mapping', '', '', ''],
    // Row 37-39
    ['', 'HR Column: Staff Name', 'C', 'Column letter in ImportHR tab containing staff names (e.g. C)'],
    ['', 'HR Column: Department', 'J', 'Column letter in ImportHR tab containing departments (e.g. J)'],
    ['', 'HR Column: Email ID', 'N', 'Column letter in ImportHR tab containing email addresses (e.g. N)'],
  ];
  // Write all data
  sheet.getRange(1, 1, data.length, 4).setValues(data);
  // ── Formatting ──
  // Title row
  var titleRange = sheet.getRange('A1:D1');
  titleRange.merge();
  titleRange.setFontSize(14).setFontWeight('bold').setFontColor('#1a1f36');
  titleRange.setBackground('#f0f2f8');
  titleRange.setHorizontalAlignment('left');
  titleRange.setVerticalAlignment('middle');
  sheet.setRowHeight(1, 44);
  // Section headers
  var sectionRows = [3, 10, 17, 25, 28, 36];
  sectionRows.forEach(function(row) {
    var range = sheet.getRange(row, 1, 1, 4);
    range.setFontSize(11).setFontWeight('bold').setFontColor('#1a1f36');
    range.setBackground('#e8ecf4');
    sheet.setRowHeight(row, 32);
  });
  // Sub-header row (Department roles)
  var subHeaderRange = sheet.getRange(18, 2, 1, 3);
  subHeaderRange.setFontWeight('bold').setFontColor('#5a6a8a');
  subHeaderRange.setBackground('#f5f7fb');
  // Setting keys column - subtle style
  var keyRanges = [
    [4, 8], [11, 15], [19, 23], [26, 26], [29, 34], [37, 39]
  ];
  keyRanges.forEach(function(range) {
    sheet.getRange(range[0], 2, range[1] - range[0] + 1, 1)
      .setFontWeight('bold')
      .setFontColor('#3a4a6a');
  });
  // Notes column - muted
  sheet.getRange(1, 4, data.length, 1)
    .setFontColor('#8492a6')
    .setFontStyle('italic');
  // Value column - editable style
  var valueRows = [
    4, 5, 6, 7, 8, 11, 12, 13, 14, 15,
    19, 20, 21, 22, 23, 26,
    29, 30, 31, 32, 33, 34, 37, 38, 39
  ];
  valueRows.forEach(function(row) {
    sheet.getRange(row, 3)
      .setBackground('#fffef5')
      .setBorder(true, true, true, true, false, false, '#e0d8c0', SpreadsheetApp.BorderStyle.SOLID);
  });
  // Warning on Next Sequence Number
  sheet.getRange(7, 3).setBackground('#fff3cd');
  // Protect non-editable areas (optional - just visual for now)
  sheet.protect()
    .setDescription('Config tab — edit values in Column C only')
    .setWarningOnly(true);
  // Freeze header
  sheet.setFrozenRows(1);
  // Tab color
  sheet.setTabColor('#1a1f36');
}
// ─────────────────────────────────────────────────────────
// IMPORT HR TAB
// ─────────────────────────────────────────────────────────
/**
 * Creates and formats the ImportHR tab.
 * @param {SpreadsheetApp.Spreadsheet} ss
 */
function createImportHRTab_(ss) {
  var sheet = getOrCreateSheet_(ss, 'ImportHR');
  sheet.clear();
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 500);
  // Labels
  sheet.getRange('A1').setValue('IMPORT HR DATABASE').setFontSize(14).setFontWeight('bold').setFontColor('#1a1f36');
  sheet.getRange('A1:B1').merge().setBackground('#f0f2f8');
  sheet.setRowHeight(1, 44);
  sheet.getRange('A2').setValue('HR Database Sheet URL →').setFontWeight('bold').setFontColor('#3a4a6a');
  sheet.getRange('B2')
    .setValue('')
    .setBackground('#fffef5')
    .setBorder(true, true, true, true, false, false, '#e0d8c0', SpreadsheetApp.BorderStyle.SOLID)
    .setNote('Paste the full URL of the HR Database Google Sheet here.\nThe IMPORTRANGE formula in Row 4+ will pull the data.');
  sheet.getRange('A3').setValue('').setFontColor('#8492a6').setFontStyle('italic');
  sheet.getRange('A3:B3').merge();
  // Instructions
  sheet.getRange('A3').setValue(
    '⚠️ After pasting the URL above, you will need to manually set up IMPORTRANGE formulas in Row 4 onwards, ' +
    'OR paste the staff data directly starting from Row 5 (with headers in Row 4). ' +
    'Ensure Column N contains email IDs (as mapped in Config tab).'
  ).setFontColor('#8492a6').setFontStyle('italic').setWrap(true);
  sheet.setRowHeight(3, 52);
  // Header row placeholder
  sheet.getRange('A4').setValue('(Headers will appear here)').setFontColor('#b0b8c8');
  sheet.getRange(4, 1, 1, 20).setBackground('#e8ecf4').setFontWeight('bold');
  sheet.setFrozenRows(4);
  // Tab color
  sheet.setTabColor('#2ecc71');
}
// ─────────────────────────────────────────────────────────
// REQUESTS TAB
// ─────────────────────────────────────────────────────────
/**
 * Creates and formats the Requests tab.
 * @param {SpreadsheetApp.Spreadsheet} ss
 */
function createRequestsTab_(ss) {
  var sheet = getOrCreateSheet_(ss, 'Requests');
  sheet.clear();
  var headers = [
    'Request ID',
    'Timestamp',
    'Staff Name',
    'Staff Email',
    'Department',
    'Purpose',
    'Stock in Hand',
    'Total Items',
    'Total Approximate Cost (₹)',
    'Attachment URLs',
    'Status',
    'Submitted Date',
    'Notes'
  ];
  // Write headers
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1a1f36')
    .setHorizontalAlignment('center');
  // Set column widths
  var widths = [140, 180, 180, 240, 160, 300, 200, 100, 180, 300, 120, 140, 250];
  widths.forEach(function(w, i) {
    sheet.setColumnWidth(i + 1, w);
  });
  // Freeze header
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 36);
  // Tab color
  sheet.setTabColor('#e8913a');
}
// ─────────────────────────────────────────────────────────
// ITEMS TAB
// ─────────────────────────────────────────────────────────
/**
 * Creates and formats the Items tab.
 * @param {SpreadsheetApp.Spreadsheet} ss
 */
function createItemsTab_(ss) {
  var sheet = getOrCreateSheet_(ss, 'Items');
  sheet.clear();
  var headers = [
    'Request ID',
    'Item #',
    'Item Description',
    'Quantity',
    'Unit',
    'Approximate Cost per Unit (₹)',
    'Total Cost (₹)'
  ];
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1a1f36')
    .setHorizontalAlignment('center');
  // Set column widths
  var widths = [140, 70, 300, 100, 100, 200, 160];
  widths.forEach(function(w, i) {
    sheet.setColumnWidth(i + 1, w);
  });
  // Freeze header
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 36);
  // Tab color
  sheet.setTabColor('#d4832f');
}
// ─────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────
/**
 * Returns an existing sheet by name, or creates a new one.
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {string} name
 * @return {SpreadsheetApp.Sheet}
 */
function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}
