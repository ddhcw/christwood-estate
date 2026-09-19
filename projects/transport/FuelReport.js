/**
 * FuelReport.gs — the signed "Fuel Process" report.
 *
 * Reproduces the sheet the transport office already files: one line per fuel
 * bill, a Total, and the three signature blocks. Nothing in it is typed twice —
 * every column is either already in Fuel_Log or worked out from it.
 *
 * The rules below were read off the office's own July 2026 report, not invented:
 *   Previous Kms  = the odometer of that vehicle's PREVIOUS fuel entry
 *   Total Kms     = Filling Kms − Previous Kms, floored at 0, never blank
 *   Avg Kms       = Total Kms ÷ Qty, 2 decimals, floored at 0
 *   and when the vehicle's meter is out of action, Previous Kms prints
 *   "Speedometer - Not working" and Total/Avg are forced to 0 — even when a
 *   previous reading does exist. (Their rows 29 and 35 are the same bus with a
 *   real 813 km between them, and both print 0.)
 */

const ODO_BROKEN_TEXT = 'Speedometer - Not working';

// ---------------------------------------------------------------------------
// Building the rows
// ---------------------------------------------------------------------------

/**
 * Was this vehicle's odometer out of action on this date?
 *
 * Prefers the logged history so reprinting an old month does not relabel itself
 * every time a meter is repaired. Vehicles that pre-date the Odometer_Events tab
 * have no history at all, so for those we fall back to the current flag —
 * otherwise the first report the office runs would silently disagree with the
 * one they produced by hand.
 */
function odoBrokenOn_(vehicleId, date) {
  const ctx = odoContext_(vehicleId);
  if (ctx.broken.length) {
    const d = startOfDay_(date);
    return ctx.broken.some(function (w) {
      return d >= w.from && (w.to === null || d < w.to);
    });
  }
  return !odoWorks_(vehicleId); // no history recorded — trust the current flag
}

/**
 * Every fuel row that belongs on a report for this date range.
 *
 * Includes anything dated in the range, plus any older entry that has never
 * been carried by a report — that is how a bill handed in late still gets paid.
 * Voided rows are left out entirely.
 */
function fuelReportRows_(fromDate, toDate) {
  const from = startOfDay_(fromDate), to = startOfDay_(toDate);
  const regOf = {}, routeOf = {};
  getRows_(SHEETS.VEHICLES).forEach(function (v) {
    regOf[v.vehicle_id] = v.reg_no || v.vehicle_id;
    routeOf[v.vehicle_id] = v.route_no || '';
  });
  const nameOf = {};
  getRows_(SHEETS.DRIVERS).forEach(function (d) { nameOf[d.driver_id] = d.name || ''; });

  const all = getRows_(SHEETS.FUEL).filter(function (r) {
    return !isVoided_(r) && !isBlank_(r.vehicle_id) && parseDate_(r.date);
  });

  // Previous Kms chains off the vehicle's own earlier fills, so the lookup has
  // to see the whole history, not just the rows inside the range.
  const priorOdo = {};
  const byVehicle = {};
  all.forEach(function (r) {
    (byVehicle[r.vehicle_id] = byVehicle[r.vehicle_id] || []).push(r);
  });
  Object.keys(byVehicle).forEach(function (id) {
    byVehicle[id].sort(function (a, b) {
      return parseDate_(a.date) - parseDate_(b.date) || billNum_(a) - billNum_(b);
    });
    var last = null;
    byVehicle[id].forEach(function (r) {
      priorOdo[r.entry_id] = last;
      // Only a propellant fill advances the meter chain; a can of AdBlue does not.
      if (isPropellant_(r.product) && toNum_(r.odometer) !== null) last = toNum_(r.odometer);
    });
  });

  const chosen = all.filter(function (r) {
    const d = startOfDay_(parseDate_(r.date));
    if (d >= from && d <= to) return true;
    return d < from && isBlank_(r.reported_in); // a straggler nobody has billed yet
  });

  // The office's report runs in bill order, and its S.No follows that.
  chosen.sort(function (a, b) {
    const ba = billNum_(a), bb = billNum_(b);
    if (ba !== null && bb !== null && ba !== bb) return ba - bb;
    if (ba !== null && bb === null) return -1;
    if (ba === null && bb !== null) return 1;
    return parseDate_(a.date) - parseDate_(b.date);
  });

  return chosen.map(function (r, i) {
    const date = parseDate_(r.date);
    const qty = toNum_(r.litres);
    const propellant = isPropellant_(r.product);
    const broken = propellant && odoBrokenOn_(r.vehicle_id, date);

    const fill = toNum_(r.odometer);
    var prev = propellant ? priorOdo[r.entry_id] : null;
    if (prev === undefined) prev = null;

    // A meter that was replaced makes the two readings incomparable.
    var crossed = false;
    if (!broken && propellant && prev !== null) {
      const ctx = odoContext_(r.vehicle_id);
      if (ctx.eraFrom && startOfDay_(date) >= ctx.eraFrom) {
        const prevRow = lastRowBefore_(byVehicle[r.vehicle_id], r);
        if (prevRow && startOfDay_(parseDate_(prevRow.date)) < ctx.eraFrom) crossed = true;
      }
    }

    var total = 0;
    if (!broken && !crossed && prev !== null && fill !== null) total = Math.max(0, fill - prev);
    const avg = (qty && qty > 0) ? Math.max(0, round2_(total / qty)) : 0;

    return {
      sno: i + 1,
      route_no: routeOf[r.vehicle_id] || '',
      // A consumable prints its product name where a registration would go,
      // exactly as the office writes "AdBlue" on the voucher.
      vehicle_reg: propellant ? (regOf[r.vehicle_id] || r.vehicle_id) : String(r.product || 'Other'),
      bill_no: r.bill_no == null ? '' : String(r.bill_no),
      date: Utilities.formatDate(date, TZ_(), 'dd-MM-yyyy'),
      qty: qty === null ? '' : qty,
      amount: toNum_(r.amount) || 0,
      driver_name: nameOf[r.driver_id] || '',
      previous_kms: broken ? ODO_BROKEN_TEXT : (propellant && prev !== null && !crossed ? prev : 0),
      filling_kms: (propellant && fill !== null) ? fill : 0,
      station: r.station || '',
      total_kms: total,
      avg_kms: avg,
      entry_id: r.entry_id,
      _straggler: startOfDay_(date) < from
    };
  });
}

function billNum_(r) {
  const m = String(r.bill_no || '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

function lastRowBefore_(rows, target) {
  var prev = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].entry_id === target.entry_id) return prev;
    if (isPropellant_(rows[i].product) && toNum_(rows[i].odometer) !== null) prev = rows[i];
  }
  return prev;
}

// ---------------------------------------------------------------------------
// Preview (what the Dashboard shows before you commit to a PDF)
// ---------------------------------------------------------------------------

function previewFuelReport(token, fromStr, toStr) {
  if (!adminName_(token)) return needAdmin_();
  try {
    const from = parseDate_(fromStr), to = parseDate_(toStr);
    if (!from || !to) return fail_('Pick both a start and an end date.');
    if (startOfDay_(to) < startOfDay_(from)) return fail_('The end date is before the start date.');
    const rows = fuelReportRows_(from, to);
    return {
      ok: true,
      from: Utilities.formatDate(from, TZ_(), 'dd MMM yyyy'),
      to: Utilities.formatDate(to, TZ_(), 'dd MMM yyyy'),
      count: rows.length,
      stragglers: rows.filter(function (r) { return r._straggler; }).length,
      missingBill: rows.filter(function (r) { return !r.bill_no; }).length,
      missingDriver: rows.filter(function (r) { return !r.driver_name; }).length,
      brokenOdo: rows.filter(function (r) { return r.previous_kms === ODO_BROKEN_TEXT; }).length,
      total: round2_(rows.reduce(function (s, r) { return s + r.amount; }, 0)),
      rows: rows.slice(0, 200)
    };
  } catch (e) { return fail_(e.message); }
}

// ---------------------------------------------------------------------------
// The PDF
// ---------------------------------------------------------------------------

const RPT_HEADERS = ['S. No', 'Route No', 'Vehicle Reg', 'Bill No', 'Date of Fuel', 'Qty', 'Amount',
                     'Driver Name', 'Previous Kms', 'Filling Kms', 'FILLING STATION',
                     'Total Kms', 'Avg Kms'];

/**
 * Build the report as a PDF and hand it back.
 *
 * Built with DocumentApp because it is the only route where landscape, page
 * breaks and the blue header band are all documented: Body.setPageWidth /
 * setPageHeight take points, and 792 x 612 is exactly the geometry of the
 * office's existing report. The PDF comes back base64-encoded because this web
 * app is open to anyone — a Drive link created by the script would just prompt
 * an anonymous user to sign in.
 */
function generateFuelReport(token, fromStr, toStr) {
  const who = adminName_(token); if (!who) return needAdmin_();
  const lock = LockService.getScriptLock();
  var doc = null;
  try {
    if (!lock.tryLock(30000)) return fail_('Another report is being generated. Try again in a moment.');
    const from = parseDate_(fromStr), to = parseDate_(toStr);
    if (!from || !to) return fail_('Pick both a start and an end date.');
    if (startOfDay_(to) < startOfDay_(from)) return fail_('The end date is before the start date.');

    const rows = fuelReportRows_(from, to);
    if (!rows.length) return fail_('No fuel entries in that period — nothing to report.');

    const s = getSettings();
    const sym = s.currency_symbol || '₹';
    const label = Utilities.formatDate(from, TZ_(), 'd MMM yyyy') + ' to ' +
                  Utilities.formatDate(to, TZ_(), 'd MMM yyyy');
    const reportId = 'FR' + Utilities.formatDate(new Date(), TZ_(), 'yyyyMMdd-HHmmss');
    const name = (s.fuel_report_title || 'Fuel Process') + ' ' + label;

    doc = DocumentApp.create(name);
    const body = doc.getBody();
    body.setPageWidth(792).setPageHeight(612);         // Letter, landscape
    body.setMarginTop(28).setMarginBottom(28).setMarginLeft(28).setMarginRight(28);
    // A new Document starts with one empty paragraph; drop it at the end.
    const seed = body.getChild(0);

    // Explicit sizes and spacing rather than a Docs heading style, whose large
    // built-in spacing is not accounted for in the rows-per-page budget.
    body.appendParagraph(s.school_name || 'Fleet')
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setForegroundColor('#1e3a5f').setFontSize(14).setBold(true)
        .setLineSpacing(1).setSpacingBefore(0).setSpacingAfter(2);
    body.appendParagraph((s.fuel_report_title || 'Fuel Process') + ' — ' + label)
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setForegroundColor('#555555').setFontSize(9).setBold(false)
        .setLineSpacing(1).setSpacingBefore(0).setSpacingAfter(6);

    const perPage = Math.max(5, parseInt(s.fuel_report_rows_per_page, 10) || 23);
    const money = function (n) { return round2_(n); };
    const total = rows.reduce(function (sum, r) { return sum + r.amount; }, 0);

    // Split the rows across pages, leaving room for what else has to fit.
    // Page 1 carries the heading block; the final page carries the Total line
    // and the three signature blocks. Without these allowances Docs pushes the
    // overflow onto a page of its own, which is what stranded "Prepared By" at
    // the foot of one page and its names on the next.
    const pages = paginateReport_(rows.length, perPage);

    pages.forEach(function (page, pi) {
      const chunk = rows.slice(page.from, page.to);
      const data = [RPT_HEADERS].concat(chunk.map(function (r) {
        return [String(r.sno), r.route_no, r.vehicle_reg, r.bill_no, r.date,
                r.qty === '' ? '' : String(r.qty), String(money(r.amount)), r.driver_name,
                String(r.previous_kms), String(r.filling_kms), r.station,
                String(r.total_kms), r.avg_kms.toFixed(2)];
      }));
      // The Total belongs to the last page's table, so it can never be orphaned
      // from the rows it totals. Summed at full precision and rounded once.
      if (pi === pages.length - 1) {
        data.push(['', '', '', 'Total', '', '', sym + Math.round(total).toLocaleString('en-IN'),
                   '', '', '', '', '', '']);
      }
      const table = body.appendTable(data);
      styleReportTable_(table, pi === pages.length - 1);
      if (pi < pages.length - 1) body.appendPageBreak();
    });

    appendSignatures_(body, s);
    body.removeChild(seed);
    doc.saveAndClose();   // must happen before getAs, or unsaved edits are missed

    const file = DriveApp.getFileById(doc.getId());
    const pdf = file.getAs('application/pdf').setName(name + '.pdf');

    // Keep a filed copy, and hand the same bytes straight back to the browser.
    const folder = reportFolder_();
    const saved = folder.createFile(pdf);
    file.setTrashed(true);   // the working Doc was scaffolding, the PDF is the artefact

    stampReported_(rows, reportId);
    appendRow_(SHEETS.FUELRPT, {
      report_id: reportId, generated_at: new Date(),
      from_date: startOfDay_(from), to_date: startOfDay_(to),
      rows: rows.length, total_amount: round2_(total),
      generated_by: who, file_url: saved.getUrl()
    });

    return {
      ok: true,
      message: 'Report ready — ' + rows.length + ' entries, ' + sym +
               Math.round(total).toLocaleString('en-IN') + '. A copy is filed in Drive.',
      filename: name + '.pdf',
      driveUrl: saved.getUrl(),
      b64: Utilities.base64Encode(pdf.getBytes())
    };
  } catch (e) {
    if (doc) { try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (e2) {} }
    return fail_(e.message);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * How the data rows divide across pages.
 *
 * `perPage` is what the office wants a page to look like (23, matching their
 * existing paperwork). PHYSICAL_MAX is what actually fits: 556pt of usable
 * height — 612pt less two 28pt margins — at roughly 13pt a row once the cell
 * font is pinned to 8pt, less the column header. That is about 41 rows, and 34
 * is used here to leave room for the handful of rows that wrap, such as
 * "Speedometer - Not working" or a long driver name.
 *
 * A page only gives up rows when it has to: the first page for the heading, the
 * last for the Total line and signatures. At 23 rows a page none of that bites,
 * so a 23-row report still prints on one page.
 *
 * Returns [{from, to}] index pairs.
 */
function paginateReport_(count, perPage) {
  const PHYSICAL_MAX = 34;
  const HEADING_ROWS = 3;   // school name, date range, breathing room
  const FOOTER_ROWS  = 6;   // Total line + the three signature blocks
  const pages = [];
  var i = 0;
  while (i < count) {
    const isFirst = (i === 0);
    const headroom = PHYSICAL_MAX - (isFirst ? HEADING_ROWS : 0);
    var cap = Math.min(perPage, headroom);
    const remaining = count - i;
    if (remaining <= cap) {
      // Everything left fits here, so this is the last page and the total and
      // signatures have to fit too. If they will not, spill the tail over.
      const lastCap = Math.min(perPage, headroom - FOOTER_ROWS);
      if (remaining > lastCap) cap = lastCap;
    }
    const take = Math.max(1, Math.min(remaining, cap));
    pages.push({ from: i, to: i + take });
    i += take;
  }
  return pages.length ? pages : [{ from: 0, to: 0 }];
}

/** Stamp each included row so a late bill is never billed twice. */
function stampReported_(rows, reportId) {
  const sh = sheet_(SHEETS.FUEL);
  const headers = HEADERS[SHEETS.FUEL];
  const idIdx = headers.indexOf('entry_id'), rpIdx = headers.indexOf('reported_in');
  const last = sh.getLastRow();
  if (idIdx < 0 || rpIdx < 0 || last < 2) return;
  if (rpIdx >= readableCols_(sh, headers)) return; // column not built yet
  const want = {};
  rows.forEach(function (r) { if (r.entry_id) want[String(r.entry_id).trim()] = true; });

  const ids = sh.getRange(2, idIdx + 1, last - 1, 1).getValues();
  const stamps = sh.getRange(2, rpIdx + 1, last - 1, 1).getValues();
  var changed = false;
  for (var i = 0; i < ids.length; i++) {
    if (want[String(ids[i][0]).trim()] && String(stamps[i][0]).trim() === '') {
      stamps[i][0] = reportId; changed = true;
    }
  }
  if (changed) {
    sh.getRange(2, rpIdx + 1, stamps.length, 1).setValues(stamps);
    delete ROWS_MEMO_[SHEETS.FUEL];
  }
}

function reportFolder_() {
  const it = DriveApp.getFoldersByName('Fleet Fuel Reports');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Fleet Fuel Reports');
}

// ---------------------------------------------------------------------------
// Duplicate fuel entries (dashboard, read-only)
//
// A "duplicate" here means exactly one thing, by definition: same vehicle +
// same calendar date + same amount. All three must match. This does not
// widen to a fuzzy match, and it only ever looks at Fuel_Log — trip,
// attendance and maintenance entries are out of scope for this check.
//
// This is a pure read + group operation: it never edits, voids or merges a
// row. It only points at rows that look like a double entry so a human can
// check them (and fix/void from Fix Entries if they agree).
// ---------------------------------------------------------------------------

/**
 * Group non-voided Fuel_Log rows by vehicle + calendar date (Asia/Kolkata) +
 * numeric amount, and return only the groups with more than one row.
 *
 * Dates are compared as calendar dates via Utilities.formatDate (not string
 * equality), so a real Date, a serial or a typed "yyyy-MM-dd" all land on the
 * same key. Amounts are parsed with toNum_ and rounded to 2 decimals, so
 * "12.0", "12" and "12 " (trailing space) all match.
 */
function duplicateFuelGroups_() {
  const regOf = vehicleRegMap_();
  const groups = {};
  getRows_(SHEETS.FUEL).forEach(function (r) {
    if (isVoided_(r) || isBlank_(r.vehicle_id)) return;
    const d = parseDate_(r.date);
    const amt = toNum_(r.amount);
    if (!d || amt === null) return;
    const dayKey = Utilities.formatDate(d, TZ_(), 'yyyy-MM-dd');
    const amtKey = round2_(amt).toFixed(2);
    const key = r.vehicle_id + '|' + dayKey + '|' + amtKey;
    (groups[key] = groups[key] || []).push({
      entry_id: r.entry_id,
      vehicle_id: r.vehicle_id,
      reg_no: regOf[r.vehicle_id] || r.vehicle_id,
      date: Utilities.formatDate(d, TZ_(), 'dd MMM yyyy'),
      amount: round2_(amt),
      litres: toNum_(r.litres),
      product: r.product || 'Diesel',
      bill_no: r.bill_no || '',
      station: r.station || '',
      odometer: toNum_(r.odometer),
      entered_by: r.entered_by || ''
    });
  });
  const out = [];
  Object.keys(groups).forEach(function (key) {
    const entries = groups[key];
    if (entries.length < 2) return;
    out.push({
      vehicle_id: entries[0].vehicle_id,
      reg_no: entries[0].reg_no,
      date: entries[0].date,
      amount: entries[0].amount,
      count: entries.length,
      entries: entries
    });
  });
  out.sort(function (a, b) { return b.count - a.count || a.reg_no.localeCompare(b.reg_no); });
  return out;
}

function styleReportTable_(table, hasTotalRow) {
  table.setBorderWidth(1);
  const totalRowIdx = hasTotalRow ? table.getNumRows() - 1 : -1;
  // Sums to 734pt, just inside the 736pt of usable width (792 less two 28pt
  // margins). Driver Name is the widest because real names here run to about
  // 24 characters, and a wrapped name doubles its row's height.
  const widths = [28, 44, 76, 42, 60, 36, 52, 118, 62, 48, 90, 40, 38];
  for (var r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (var c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      if (widths[c]) cell.setWidth(widths[c]);
      cell.setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(3).setPaddingRight(3);
      if (r === 0) {
        cell.setBackgroundColor('#1e9ae0');
        styleCell_(cell, true, DocumentApp.HorizontalAlignment.CENTER, '#FFFFFF', 7);
      } else if (r === totalRowIdx) {
        cell.setBackgroundColor('#F7F4FB');
        styleCell_(cell, true, DocumentApp.HorizontalAlignment.CENTER, '#000000', 8);
      } else {
        styleCell_(cell, false, DocumentApp.HorizontalAlignment.CENTER, '#000000', 8);
      }
    }
  }
}

/**
 * Style one table cell.
 *
 * Everything is set on the PARAGRAPH, not on the text run. A cell with no text
 * — an unset route number, a Sunday on the attendance grid — has no run to
 * style, so it would keep Google Docs' 11pt default and make its whole row
 * taller than the ones around it. That is what was pushing a row off the bottom
 * of each page.
 */
function styleCell_(cell, bold, align, colour, size) {
  // Every paragraph in the cell, not just the first: a value containing a line
  // break becomes several paragraphs, and any left unstyled reverts to 11pt.
  for (var i = 0; i < cell.getNumChildren(); i++) {
    const child = cell.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    child.asParagraph()
      .setAlignment(align)
      .setSpacingBefore(0).setSpacingAfter(0)
      .setLineSpacing(1)
      .setFontSize(size || 8)
      .setBold(!!bold)
      .setForegroundColor(colour || '#000000');
  }
}

/**
 * The three signature blocks.
 *
 * One table row rather than four, with the label, the signing space and the
 * name/title carried as line breaks inside a single cell. A four-row table can
 * be split across a page boundary by Docs — which is how "Prepared By" ended up
 * alone at the foot of one page with the names on the next. One row cannot
 * split between its own lines the same way.
 */
function appendSignatures_(body, s) {
  body.appendParagraph('')
      .setFontSize(8).setLineSpacing(1).setSpacingBefore(10).setSpacingAfter(0);
  const cols = [
    ['Prepared By', s.report_prepared_by, s.report_prepared_title],
    ['Verified',    s.report_verified_by, s.report_verified_title],
    ['Approved By', s.report_approved_by, s.report_approved_title]
  ];
  // Label, three blank lines to sign in, then name and title — all inside one
  // table row. A multi-row table can be split across a page boundary by Docs,
  // which is what stranded "Prepared By" at the foot of one page and its names
  // on the next; a single row cannot break between its own lines that way.
  const table = body.appendTable([cols.map(function (c) {
    return c[0] + '\n\n\n' + (c[1] || '') + '\n' + (c[2] || '');
  })]);
  table.setBorderWidth(0);
  const row = table.getRow(0);
  for (var c = 0; c < 3; c++) {
    const cell = row.getCell(c);
    cell.setWidth(240).setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(2).setPaddingRight(2);
    styleCell_(cell, false, DocumentApp.HorizontalAlignment.LEFT, '#000000', 9);
    // Bold just the name and title, which are the last two paragraphs.
    const n = cell.getNumChildren();
    for (var k = Math.max(0, n - 2); k < n; k++) {
      const ch = cell.getChild(k);
      if (ch.getType() === DocumentApp.ElementType.PARAGRAPH) ch.asParagraph().setBold(true);
    }
  }
}
