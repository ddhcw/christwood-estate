/**
 * ═══════════════════════════════════════════════════════════════
 * CHRISTWOOD PURCHASE REQUEST SYSTEM — Request Service
 * ═══════════════════════════════════════════════════════════════
 * Handles submission, retrieval, and management of purchase
 * requests. Writes to Requests and Items tabs.
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Submits a new purchase request.
 *
 * @param {Object} formData - The form submission data
 * @param {Object[]} formData.items - Array of {description, quantity, unit, costPerUnit}
 * @param {string} formData.purpose - Purpose of the purchase
 * @param {string} formData.stockInHand - Current stock (optional)
 * @param {string} formData.notes - Additional notes (optional)
 * @return {Object} {success, requestId, error}
 */
function submitRequest(formData) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(15000);

    // ── Validate user ──
    var email = getCurrentUserEmail();
    if (!email) {
      // Check for manually provided email (guest users)
      if (formData.guestEmail) {
        email = formData.guestEmail;
        if (!isGuestUser(email)) {
          return { success: false, error: 'This email is not authorised to submit requests.' };
        }
      } else {
        return { success: false, error: 'Unable to identify you. Please sign in with your Google account.' };
      }
    }

    var isGuest = isGuestUser(email);
    var isHRValid = validateUser(email);

    if (!isHRValid && !isGuest) {
      return { success: false, error: 'Your email (' + email + ') is not authorised to submit purchase requests.' };
    }

    // ── Get user info ──
    var userInfo = isHRValid ? getUserInfo(email) : buildGuestInfo_(email);

    // ── Validate form data ──
    var validation = validateFormData_(formData);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // ── Check for duplicate submissions (last 7 days) ──
    var dupCheck = checkDuplicateRequest_(email, formData);
    if (dupCheck.isDuplicate && !formData.forceDuplicate) {
      return {
        success: false,
        isDuplicate: true,
        error: 'A similar request (' + dupCheck.existingId + ') was submitted on ' +
               dupCheck.existingDate + '. Are you sure you want to submit again?'
      };
    }

    // ── Generate request ID ──
    var requestId = getNextRequestId();

    // ── Calculate totals ──
    var items = formData.items;
    var totalCost = 0;
    for (var i = 0; i < items.length; i++) {
      var qty = parseFloat(items[i].quantity) || 0;
      var cost = parseFloat(items[i].costPerUnit) || 0;
      items[i].totalCost = qty * cost;
      totalCost += items[i].totalCost;
    }

    // ── Handle file attachments ──
    var attachmentUrls = [];
    if (formData.attachments && formData.attachments.length > 0) {
      for (var j = 0; j < formData.attachments.length; j++) {
        var att = formData.attachments[j];
        var url = uploadAttachment(att.data, att.name, att.mimeType, requestId);
        if (url) {
          attachmentUrls.push(url);
        }
      }
    }

    // ── Write to Requests tab ──
    var now = new Date();
    var timestamp = now.toISOString();
    var submittedDate = formatDateDMY_(now);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var requestsSheet = ss.getSheetByName('Requests');

    var requestRow = [
      requestId,
      timestamp,
      userInfo.name,
      email,
      userInfo.department,
      formData.purpose,
      formData.stockInHand || '',
      items.length,
      totalCost,
      attachmentUrls.join(', '),
      'Submitted',
      submittedDate,
      formData.notes || ''
    ];

    requestsSheet.appendRow(requestRow);

    // ── Write to Items tab ──
    var itemsSheet = ss.getSheetByName('Items');

    for (var k = 0; k < items.length; k++) {
      var itemRow = [
        requestId,
        k + 1,
        items[k].description,
        parseFloat(items[k].quantity) || 0,
        items[k].unit || '',
        parseFloat(items[k].costPerUnit) || 0,
        items[k].totalCost
      ];
      itemsSheet.appendRow(itemRow);
    }

    SpreadsheetApp.flush();

    // ── Send notifications ──
    // Each notification is isolated in its own try/catch so a failure in
    // one (e.g. MailApp.sendEmail throwing for the submission notice)
    // cannot suppress the other (the Admin Head / CEO approval notice).
    var notificationData = {
      requestId: requestId,
      staffName: userInfo.name,
      staffEmail: email,
      department: userInfo.department,
      purpose: formData.purpose,
      items: items,
      totalCost: totalCost,
      submittedDate: submittedDate,
      attachmentCount: attachmentUrls.length
    };

    try {
      sendSubmissionNotification(notificationData);
    } catch (submissionNotifError) {
      Logger.log('Submission notification failed (request still saved): ' + submissionNotifError.message);
    }

    try {
      sendApprovalNotification(notificationData);
    } catch (approvalNotifError) {
      Logger.log('Approval notification failed (request still saved): ' + approvalNotifError.message);
    }

    return {
      success: true,
      requestId: requestId,
      message: 'Purchase request ' + requestId + ' submitted successfully.'
    };

  } catch (e) {
    Logger.log('submitRequest error: ' + e.message + '\n' + e.stack);
    return { success: false, error: 'An unexpected error occurred: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns purchase requests for the current user.
 * Regular staff see only their own requests.
 * Department role users see all requests.
 *
 * @param {number} [limit] - Max requests to return (default 100)
 * @param {number} [offset] - Offset for pagination (default 0)
 * @return {Object} {requests[], totalCount, hasMore}
 */
function getRequests(limit, offset) {
  limit = limit || 100;
  offset = offset || 0;

  var email = getCurrentUserEmail();
  if (!email) {
    Logger.log('getRequests: getCurrentUserEmail() returned empty.');
    return { requests: [], totalCount: 0, hasMore: false, debug: 'no_email' };
  }

  var role = getViewerRole(email);
  var showAll = (role !== null);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var requestsSheet = ss.getSheetByName('Requests');
  var lastRow = requestsSheet.getLastRow();

  if (lastRow < 2) {
    return { requests: [], totalCount: 0, hasMore: false, debug: 'no_data_rows' };
  }

  var data = requestsSheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var results = [];

  // Iterate in reverse (newest first)
  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    var reqEmail = String(row[3] || '').toLowerCase().trim();

    // Skip empty rows
    if (!reqEmail) continue;

    // Filter by user if not a dept role viewer
    if (!showAll && reqEmail !== email.toLowerCase().trim()) {
      continue;
    }

    // Coerce all values to safe serializable types
    var submittedDate = row[11];
    if (submittedDate instanceof Date) {
      submittedDate = formatDateDMY_(submittedDate);
    } else {
      submittedDate = String(submittedDate || '');
    }

    var timestamp = row[1];
    if (timestamp instanceof Date) {
      timestamp = timestamp.toISOString();
    } else {
      timestamp = String(timestamp || '');
    }

    results.push({
      requestId: String(row[0] || ''),
      timestamp: timestamp,
      staffName: String(row[2] || ''),
      staffEmail: String(row[3] || ''),
      department: String(row[4] || ''),
      purpose: String(row[5] || ''),
      stockInHand: String(row[6] || ''),
      totalItems: Number(row[7]) || 0,
      totalCost: Number(row[8]) || 0,
      attachmentUrls: row[9] ? String(row[9]).split(',').map(function(u) { return u.trim(); }).filter(function(u) { return u; }) : [],
      status: String(row[10] || 'Submitted'),
      submittedDate: submittedDate,
      notes: String(row[12] || '')
    });
  }

  var totalCount = results.length;
  var paged = results.slice(offset, offset + limit);

  return {
    requests: paged,
    totalCount: totalCount,
    hasMore: (offset + limit) < totalCount,
    canPrint: role !== null && role.access && role.access.indexOf('Print') > -1,
    viewerRole: role
  };
}

/**
 * Returns a single request with its line items (for viewing/printing).
 *
 * @param {string} requestId
 * @return {Object|null} Full request data with items
 */
function getRequestById(requestId) {
  if (!requestId) return null;

  var email = getCurrentUserEmail();
  var role = getViewerRole(email);

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Get request ──
  var requestsSheet = ss.getSheetByName('Requests');
  var lastRow = requestsSheet.getLastRow();
  if (lastRow < 2) return null;

  var requestData = requestsSheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var request = null;

  for (var i = 0; i < requestData.length; i++) {
    if (String(requestData[i][0]).trim() === String(requestId).trim()) {
      var sd = requestData[i][11];
      if (sd instanceof Date) {
        sd = formatDateDMY_(sd);
      } else {
        sd = String(sd || '');
      }
      var ts = requestData[i][1];
      if (ts instanceof Date) {
        ts = ts.toISOString();
      } else {
        ts = String(ts || '');
      }

      request = {
        requestId: String(requestData[i][0] || ''),
        timestamp: ts,
        staffName: String(requestData[i][2] || ''),
        staffEmail: String(requestData[i][3] || ''),
        department: String(requestData[i][4] || ''),
        purpose: String(requestData[i][5] || ''),
        stockInHand: String(requestData[i][6] || ''),
        totalItems: Number(requestData[i][7]) || 0,
        totalCost: Number(requestData[i][8]) || 0,
        attachmentUrls: requestData[i][9]
          ? String(requestData[i][9]).split(',').map(function(u) { return u.trim(); }).filter(function(u) { return u; })
          : [],
        status: String(requestData[i][10] || 'Submitted'),
        submittedDate: sd,
        notes: String(requestData[i][12] || '')
      };
      break;
    }
  }

  if (!request) return null;

  // ── Access check ──
  var isOwner = (email && email.toLowerCase() === request.staffEmail.toLowerCase());
  if (!isOwner && !role) {
    return { error: 'You do not have permission to view this request.' };
  }

  // ── Get items ──
  var itemsSheet = ss.getSheetByName('Items');
  var itemsLastRow = itemsSheet.getLastRow();
  var items = [];

  if (itemsLastRow >= 2) {
    var itemsData = itemsSheet.getRange(2, 1, itemsLastRow - 1, 7).getValues();
    for (var j = 0; j < itemsData.length; j++) {
      if (String(itemsData[j][0]).trim() === String(requestId).trim()) {
        items.push({
          itemNum: Number(itemsData[j][1]) || 0,
          description: String(itemsData[j][2] || ''),
          quantity: Number(itemsData[j][3]) || 0,
          unit: String(itemsData[j][4] || ''),
          costPerUnit: Number(itemsData[j][5]) || 0,
          totalCost: Number(itemsData[j][6]) || 0
        });
      }
    }
  }

  request.items = items;

  // ── Add print data ──
  var config = getConfig();
  request.schoolName = config.schoolName;
  request.digitalSignature = getDigitalSignatureText(request.staffEmail, request.submittedDate);
  request.canPrint = (role !== null && role.access && role.access.indexOf('Print') > -1) || isOwner;

  return request;
}

/**
 * Uploads a file attachment to Google Drive.
 *
 * @param {string} base64Data - Base64 encoded file content
 * @param {string} fileName - Original file name
 * @param {string} mimeType - MIME type of the file
 * @param {string} requestId - Associated request ID (used in folder organization)
 * @return {string} URL of the uploaded file
 */
function uploadAttachment(base64Data, fileName, mimeType, requestId) {
  try {
    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ssFile = DriveApp.getFileById(ss.getId());
    var parentFolder = ssFile.getParents().next();

    // Get or create the attachments folder
    var attachFolder;
    if (config.attachFolderId) {
      attachFolder = DriveApp.getFolderById(config.attachFolderId);
    } else {
      var parentName = parentFolder.getName();
      // Remove trailing ']' if present
      if (parentName.slice(-1) === ']') {
        parentName = parentName.slice(0, -1);
      }
      var attachFolderName = parentName + '] MRN-SUBMISSIONS]';
      attachFolder = getOrCreateFolder_(parentFolder, attachFolderName);
    }

    // Create a sub-folder for this request
    var requestFolder = getOrCreateFolder_(attachFolder, requestId);

    // Decode and save the file
    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, mimeType, fileName);
    var file = requestFolder.createFile(blob);

    // Make viewable by anyone with the link (within domain)
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

    return file.getUrl();
  } catch (e) {
    Logger.log('uploadAttachment error: ' + e.message);
    return '';
  }
}

// ─────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────

/**
 * Validates the form data before submission.
 * @param {Object} formData
 * @return {Object} {valid: boolean, error: string}
 * @private
 */
function validateFormData_(formData) {
  if (!formData) {
    return { valid: false, error: 'No form data received.' };
  }

  // Items validation
  if (!formData.items || formData.items.length === 0) {
    return { valid: false, error: 'Please add at least one item to the request.' };
  }

  for (var i = 0; i < formData.items.length; i++) {
    var item = formData.items[i];
    if (!item.description || String(item.description).trim().length < 3) {
      return { valid: false, error: 'Item ' + (i + 1) + ': Description must be at least 3 characters.' };
    }
    if (!item.quantity || isNaN(parseFloat(item.quantity)) || parseFloat(item.quantity) <= 0) {
      return { valid: false, error: 'Item ' + (i + 1) + ': Quantity must be a positive number.' };
    }
    if (item.costPerUnit !== undefined && item.costPerUnit !== '' && isNaN(parseFloat(item.costPerUnit))) {
      return { valid: false, error: 'Item ' + (i + 1) + ': Cost per unit must be a valid number.' };
    }
  }

  // Purpose validation
  if (!formData.purpose || String(formData.purpose).trim().length < 5) {
    return { valid: false, error: 'Purpose must be at least 5 characters long.' };
  }

  // Attachment validation
  if (formData.attachments && formData.attachments.length > 0) {
    var config = getConfig();
    var allowedTypes = config.allowedFileTypes.split(',').map(function(t) { return t.trim().toLowerCase(); });

    for (var j = 0; j < formData.attachments.length; j++) {
      var att = formData.attachments[j];
      var ext = att.name.split('.').pop().toLowerCase();

      if (allowedTypes.indexOf(ext) === -1) {
        return { valid: false, error: 'File "' + att.name + '" has an unsupported format. Allowed: ' + config.allowedFileTypes };
      }
    }
  }

  return { valid: true };
}

/**
 * Checks if a similar request was submitted recently.
 * @param {string} email
 * @param {Object} formData
 * @return {Object} {isDuplicate, existingId, existingDate}
 * @private
 */
function checkDuplicateRequest_(email, formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Requests');
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) return { isDuplicate: false };

  var sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();

  for (var i = data.length - 1; i >= 0; i--) {
    var reqEmail = String(data[i][3] || '').toLowerCase().trim();
    var rawTs = data[i][1];
    var reqTimestamp = (rawTs instanceof Date) ? rawTs : new Date(rawTs);
    var reqPurpose = String(data[i][5] || '').toLowerCase().trim();

    if (reqTimestamp < sevenDaysAgo) break; // Older than 7 days, stop checking

    if (reqEmail === email.toLowerCase().trim()) {
      // Check if purpose is similar (simple substring match)
      var currentPurpose = String(formData.purpose).toLowerCase().trim();
      if (reqPurpose === currentPurpose ||
          (currentPurpose.length > 10 && reqPurpose.indexOf(currentPurpose.substring(0, 10)) > -1)) {
        return {
          isDuplicate: true,
          existingId: data[i][0],
          existingDate: data[i][11]
        };
      }
    }
  }

  return { isDuplicate: false };
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Gets or creates a folder within a parent folder.
 * @param {DriveApp.Folder} parent
 * @param {string} name
 * @return {DriveApp.Folder}
 * @private
 */
function getOrCreateFolder_(parent, name) {
  var folders = parent.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(name);
}

/**
 * Formats a Date as DD/MM/YYYY.
 * @param {Date} date
 * @return {string}
 * @private
 */
function formatDateDMY_(date) {
  var d = date.getDate();
  var m = date.getMonth() + 1;
  var y = date.getFullYear();
  return (d < 10 ? '0' : '') + d + '/' + (m < 10 ? '0' : '') + m + '/' + y;
}
