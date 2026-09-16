/**
 * ═══════════════════════════════════════════════════════════════
 * CHRISTWOOD PURCHASE REQUEST SYSTEM — Notification Service
 * ═══════════════════════════════════════════════════════════════
 * Sends HTML-formatted email notifications at various stages.
 * Currently implements submission notifications only.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * Sends an email notification when a purchase request is submitted.
 *
 * @param {Object} data - Request data
 * @param {string} data.requestId
 * @param {string} data.staffName
 * @param {string} data.staffEmail
 * @param {string} data.department
 * @param {string} data.purpose
 * @param {Object[]} data.items
 * @param {number} data.totalCost
 * @param {string} data.submittedDate
 * @param {number} data.attachmentCount
 */
function sendSubmissionNotification(data) {
  var recipients = getNotificationRecipients('submission');
  if (recipients.length === 0) {
    Logger.log('No submission notification recipients configured.');
    return;
  }
  var config = getConfig();
  var webAppUrl = '';
  try {
    webAppUrl = ScriptApp.getService().getUrl();
  } catch (e) {
    webAppUrl = '';
  }
  var viewUrl = webAppUrl ? webAppUrl + '?page=print&id=' + encodeURIComponent(data.requestId) : '';
  var subject = '📋 Purchase Request ' + data.requestId + ' — ' + data.staffName + ' (' + data.department + ')';
  var html = buildNotificationHtml_(data, config, viewUrl);
  // Send to all recipients
  var recipientStr = recipients.join(',');
  MailApp.sendEmail({
    to: recipientStr,
    subject: subject,
    htmlBody: html,
    noReply: true,
    name: config.schoolName + ' Purchase System'
  });
  Logger.log('Submission notification sent to: ' + recipientStr);
}
/**
 * Builds the HTML content for the submission notification email.
 * @param {Object} data
 * @param {Object} config
 * @param {string} viewUrl
 * @return {string} HTML email content
 * @private
 */
function buildNotificationHtml_(data, config, viewUrl) {
  var itemsHtml = '';
  for (var i = 0; i < data.items.length; i++) {
    var item = data.items[i];
    itemsHtml +=
      '<tr>' +
        '<td style="padding:10px 14px;border-bottom:1px solid #eef0f4;color:#5a6378;font-size:14px;text-align:center;">' + (i + 1) + '</td>' +
        '<td style="padding:10px 14px;border-bottom:1px solid #eef0f4;color:#2c3440;font-size:14px;">' + escapeHtml_(item.description) + '</td>' +
        '<td style="padding:10px 14px;border-bottom:1px solid #eef0f4;color:#2c3440;font-size:14px;text-align:center;">' + item.quantity + ' ' + (item.unit || '') + '</td>' +
        '<td style="padding:10px 14px;border-bottom:1px solid #eef0f4;color:#2c3440;font-size:14px;text-align:right;">₹' + formatCurrency_(item.costPerUnit || 0) + '</td>' +
        '<td style="padding:10px 14px;border-bottom:1px solid #eef0f4;color:#2c3440;font-size:14px;text-align:right;font-weight:600;">₹' + formatCurrency_(item.totalCost || 0) + '</td>' +
      '</tr>';
  }
  var viewButton = viewUrl
    ? '<a href="' + viewUrl + '" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#1a1f36,#2d3555);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;margin-top:8px;">View Request →</a>'
    : '';
  var html =
    '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background-color:#f5f6fa;font-family:\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif;">' +
    // Container
    '<div style="max-width:640px;margin:0 auto;padding:24px;">' +
    // Header
    '<div style="background:linear-gradient(135deg,#1a1f36 0%,#2d3555 100%);border-radius:16px 16px 0 0;padding:32px 36px;text-align:center;">' +
      '<h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;letter-spacing:0.5px;">' +
        escapeHtml_(config.schoolName).toUpperCase() +
      '</h1>' +
      '<p style="margin:6px 0 0;color:#a8b3cc;font-size:13px;letter-spacing:1px;">PURCHASE REQUEST NOTIFICATION</p>' +
    '</div>' +
    // Body
    '<div style="background:#ffffff;padding:36px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">' +
    // Request ID badge
    '<div style="text-align:center;margin-bottom:28px;">' +
      '<span style="display:inline-block;padding:8px 20px;background:#f0f2f8;border-radius:20px;font-size:15px;font-weight:700;color:#1a1f36;letter-spacing:0.5px;">' +
        escapeHtml_(data.requestId) +
      '</span>' +
    '</div>' +
    // Staff info
    '<table style="width:100%;margin-bottom:24px;" cellpadding="0" cellspacing="0">' +
      '<tr>' +
        '<td style="padding:6px 0;color:#8492a6;font-size:13px;width:120px;">Submitted by</td>' +
        '<td style="padding:6px 0;color:#2c3440;font-size:14px;font-weight:600;">' + escapeHtml_(data.staffName) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td style="padding:6px 0;color:#8492a6;font-size:13px;">Email</td>' +
        '<td style="padding:6px 0;color:#2c3440;font-size:14px;">' + escapeHtml_(data.staffEmail) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td style="padding:6px 0;color:#8492a6;font-size:13px;">Department</td>' +
        '<td style="padding:6px 0;color:#2c3440;font-size:14px;">' + escapeHtml_(data.department) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td style="padding:6px 0;color:#8492a6;font-size:13px;">Date</td>' +
        '<td style="padding:6px 0;color:#2c3440;font-size:14px;">' + escapeHtml_(data.submittedDate) + '</td>' +
      '</tr>' +
    '</table>' +
    // Purpose
    '<div style="margin-bottom:24px;padding:16px;background:#fafbfd;border-radius:10px;border-left:4px solid #e8913a;">' +
      '<p style="margin:0 0 4px;color:#8492a6;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Purpose</p>' +
      '<p style="margin:0;color:#2c3440;font-size:14px;line-height:1.5;">' + escapeHtml_(data.purpose) + '</p>' +
    '</div>' +
    // Items table
    '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;" cellpadding="0" cellspacing="0">' +
      '<thead>' +
        '<tr style="background:#f5f6fa;">' +
          '<th style="padding:12px 14px;text-align:center;font-size:12px;color:#5a6378;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e4e7ed;width:40px;">#</th>' +
          '<th style="padding:12px 14px;text-align:left;font-size:12px;color:#5a6378;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e4e7ed;">Item</th>' +
          '<th style="padding:12px 14px;text-align:center;font-size:12px;color:#5a6378;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e4e7ed;">Qty</th>' +
          '<th style="padding:12px 14px;text-align:right;font-size:12px;color:#5a6378;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e4e7ed;">Rate</th>' +
          '<th style="padding:12px 14px;text-align:right;font-size:12px;color:#5a6378;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e4e7ed;">Total</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' +
        itemsHtml +
      '</tbody>' +
      '<tfoot>' +
        '<tr style="background:#f8f4ee;">' +
          '<td colspan="4" style="padding:12px 14px;text-align:right;font-weight:700;font-size:14px;color:#1a1f36;border-top:2px solid #e4e7ed;">Grand Total</td>' +
          '<td style="padding:12px 14px;text-align:right;font-weight:700;font-size:16px;color:#e8913a;border-top:2px solid #e4e7ed;">₹' + formatCurrency_(data.totalCost) + '</td>' +
        '</tr>' +
      '</tfoot>' +
    '</table>' +
    // Attachments note
    (data.attachmentCount > 0
      ? '<p style="color:#8492a6;font-size:13px;margin-bottom:24px;">📎 ' + data.attachmentCount + ' attachment' + (data.attachmentCount > 1 ? 's' : '') + ' included</p>'
      : '') +
    // View button
    (viewButton
      ? '<div style="text-align:center;margin-top:28px;padding-top:24px;border-top:1px solid #eef0f4;">' + viewButton + '</div>'
      : '') +
    '</div>' + // end body
    // Footer
    '<div style="text-align:center;padding:20px 0;color:#a8b3cc;font-size:12px;">' +
      '<p style="margin:0;">This is an automated notification from the ' + escapeHtml_(config.schoolName) + ' Purchase Request System.</p>' +
      '<p style="margin:4px 0 0;">Please do not reply to this email.</p>' +
    '</div>' +
    '</div>' + // end container
    '</body></html>';
  return html;
}
// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────
/**
 * Escapes HTML special characters.
 * @param {string} str
 * @return {string}
 * @private
 */
function escapeHtml_(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
/**
 * Formats a number as Indian currency (no ₹ symbol).
 * @param {number} num
 * @return {string}
 * @private
 */
function formatCurrency_(num) {
  if (isNaN(num)) return '0.00';
  num = parseFloat(num);
  // Format with 2 decimal places
  var parts = num.toFixed(2).split('.');
  var intPart = parts[0];
  var decPart = parts[1];
  // Indian number formatting (e.g., 1,00,000.00)
  var lastThree = intPart.slice(-3);
  var rest = intPart.slice(0, -3);
  if (rest.length > 0) {
    lastThree = ',' + lastThree;
    // Add commas every 2 digits for the rest
    var formatted = '';
    for (var i = rest.length - 1; i >= 0; i--) {
      formatted = rest[i] + formatted;
      if ((rest.length - i) % 2 === 0 && i > 0) {
        formatted = ',' + formatted;
      }
    }
    return formatted + lastThree + '.' + decPart;
  }
  return lastThree + '.' + decPart;
}
