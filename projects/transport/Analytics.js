/**
 * Analytics.gs — turns the raw logs into the numbers that matter.
 *
 * Nothing here is ever typed by a human. rebuildAnalytics() reads the logs,
 * works out km / cost-per-km / efficiency per vehicle per month, decides which
 * vehicles to watch, and rewrites Monthly_Summary + Dashboard.
 */

function TZ_() { return Session.getScriptTimeZone() || 'Asia/Kolkata'; }
function monthKey_(date) { return Utilities.formatDate(date, TZ_(), 'yyyy-MM'); }
function monthLabel_(key) {
  const p = key.split('-'); const d = new Date(+p[0], +p[1] - 1, 1);
  return Utilities.formatDate(d, TZ_(), 'MMM yyyy');
}
function round2_(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

/**
 * Build every monthly number, in memory. Used by both the dashboard sheet
 * and the web app so the figures are always fresh.
 * Returns { rows: [...summary objects...], byVehicle: { id: [rows sorted by month] } }
 */
function computeSummaryRows_() {
  const vehicles = getRows_(SHEETS.VEHICLES);
  const regOf = {};
  vehicles.forEach(function (v) { regOf[v.vehicle_id] = v.reg_no || v.vehicle_id; });

  const fuel  = getRows_(SHEETS.FUEL);
  const maint = getRows_(SHEETS.MAINT);
  const trip  = getRows_(SHEETS.TRIP);

  // veh -> { points:[{date,odo}], months:{ mk:{km,fuelCost,litres,maintCost,downtime,effKm,effL} } }
  const data = {};
  function veh(id) {
    if (!data[id]) data[id] = { points: [], months: {} };
    return data[id];
  }
  function month(id, mk) {
    const m = veh(id).months;
    if (!m[mk]) m[mk] = { km: 0, fuelCost: 0, litres: 0, maintCost: 0, downtime: 0,
                          effKm: 0, effL: 0, unmeasured: false };
    return m[mk];
  }

  // 1) Collect odometer points + fuel/maint monthly money. (Voided rows are ignored.)
  fuel.forEach(function (r) {
    if (isVoided_(r)) return;
    const d = parseDate_(r.date), odo = toNum_(r.odometer);
    if (!d) return;
    if (odo !== null) veh(r.vehicle_id).points.push({ date: d, odo: odo });
    const m = month(r.vehicle_id, monthKey_(d));
    // AdBlue and the like are a real running cost, so they count toward spend —
    // but they are not litres of anything the engine burns, so they must stay
    // out of every litres-based figure.
    m.fuelCost += toNum_(r.amount) || 0;
    if (isPropellant_(r.product)) m.litres += toNum_(r.litres) || 0;
  });
  maint.forEach(function (r) {
    if (isVoided_(r)) return;
    const d = parseDate_(r.date), odo = toNum_(r.odometer);
    if (!d) return;
    if (odo !== null) veh(r.vehicle_id).points.push({ date: d, odo: odo });
    const m = month(r.vehicle_id, monthKey_(d));
    m.maintCost += (toNum_(r.parts) || 0) + (toNum_(r.labour) || 0);
    m.downtime  += toNum_(r.downtime_days) || 0;
  });
  trip.forEach(function (r) {
    if (isVoided_(r)) return;
    const d = parseDate_(r.date), o = toNum_(r.open_odo), c = toNum_(r.close_odo);
    if (!d) return;
    if (o !== null) veh(r.vehicle_id).points.push({ date: d, odo: o });
    if (c !== null) veh(r.vehicle_id).points.push({ date: d, odo: c });
  });

  // 2) km per month from consecutive odometer readings.
  //    A gap is skipped when it straddles a stretch with a dead meter, or a
  //    meter replacement. The distance really covered then is unknown, and
  //    dumping it all into the month the meter came back would be a lie.
  Object.keys(data).forEach(function (id) {
    const ctx = odoContext_(id);
    const pts = data[id].points.sort(function (a, b) {
      return a.date - b.date || a.odo - b.odo;
    });
    for (var i = 1; i < pts.length; i++) {
      if (spansOdoGap_(ctx, startOfDay_(pts[i - 1].date), startOfDay_(pts[i].date))) continue;
      const km = pts[i].odo - pts[i - 1].odo;
      if (km > 0) month(id, monthKey_(pts[i].date)).km += km;
    }
  });

  // 3) Efficiency (km/L) using the full-to-full method, per vehicle.
  Object.keys(data).forEach(function (id) {
    const ctx = odoContext_(id);
    const fills = fuel.filter(function (r) {
      return r.vehicle_id === id && !isVoided_(r) && isPropellant_(r.product) &&
             parseDate_(r.date) && toNum_(r.odometer) !== null;
    }).sort(function (a, b) {
      return parseDate_(a.date) - parseDate_(b.date) || toNum_(a.odometer) - toNum_(b.odometer);
    });
    var lastFullOdo = null, lastFullDate = null, litresSince = 0;
    fills.forEach(function (r) {
      const full = yes_(r.filled_to_full);
      const litres = toNum_(r.litres) || 0;
      const odo = toNum_(r.odometer);
      const date = startOfDay_(parseDate_(r.date));
      if (lastFullOdo !== null) litresSince += litres; // fuel burned since the last full tank
      if (full) {
        if (lastFullOdo !== null && litresSince > 0 && odo > lastFullOdo &&
            !spansOdoGap_(ctx, lastFullDate, date)) {
          const m = month(id, monthKey_(parseDate_(r.date)));
          m.effKm += (odo - lastFullOdo);
          m.effL  += litresSince;
        }
        lastFullOdo = odo; lastFullDate = date; litresSince = 0;
      }
    });
  });

  // 3b) Mark the months where the meter was out of action. Money still counts;
  //     distance, cost/km and km/L do not exist for these months.
  Object.keys(data).forEach(function (id) {
    const ctx = odoContext_(id);
    if (!ctx.broken.length) return;
    Object.keys(data[id].months).forEach(function (mk) {
      const p = mk.split('-');
      const mStart = new Date(+p[0], +p[1] - 1, 1);
      const mEnd   = new Date(+p[0], +p[1], 1); // first of the following month
      const dead = ctx.broken.some(function (w) {
        return (w.to === null) ? (mEnd > w.from) : (mStart < w.to && mEnd > w.from);
      });
      if (dead) data[id].months[mk].unmeasured = true;
    });
  });

  // 4) Flatten to summary rows with running cumulative maintenance.
  const rows = [];
  const byVehicle = {};
  Object.keys(data).sort().forEach(function (id) {
    const months = Object.keys(data[id].months).sort();
    var cumMaint = 0;
    byVehicle[id] = [];
    months.forEach(function (mk) {
      const m = data[id].months[mk];
      const blind = !!m.unmeasured; // meter was out of action for part of this month
      cumMaint += m.maintCost;
      const row = {
        month: mk,
        vehicle_id: id,
        reg_no: regOf[id] || id,
        km: blind ? '' : round2_(m.km),
        fuel_cost: round2_(m.fuelCost),
        fuel_cost_per_km: (!blind && m.km > 0) ? round2_(m.fuelCost / m.km) : '',
        efficiency_kmpl: (!blind && m.effL > 0) ? round2_(m.effKm / m.effL) : '',
        maint_cost: round2_(m.maintCost),
        maint_cost_per_km: (!blind && m.km > 0) ? round2_(m.maintCost / m.km) : '',
        total_cost_per_km: (!blind && m.km > 0) ? round2_((m.fuelCost + m.maintCost) / m.km) : '',
        cumulative_maint: round2_(cumMaint),
        downtime_days: round2_(m.downtime),
        notes: blind ? 'Odometer not working — distance not measured' : '',
        unmeasured: blind // not a Monthly_Summary column; used by the dashboard
      };
      rows.push(row);
      byVehicle[id].push(row);
    });
  });

  return { rows: rows, byVehicle: byVehicle, regOf: regOf };
}

/**
 * MAIN: rewrite Monthly_Summary and Dashboard. Run from the menu or a trigger.
 */
function rebuildAnalytics() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = computeSummaryRows_();
  writeSummary_(ss, result.rows);
  buildDashboard_(ss, result);
  SpreadsheetApp.getActive().toast('Dashboard updated.', 'Fleet', 4);
}

function writeSummary_(ss, rows) {
  const sh = ss.getSheetByName(SHEETS.SUMMARY) || ss.insertSheet(SHEETS.SUMMARY);
  const headers = HEADERS[SHEETS.SUMMARY];
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).clearContent();
  if (rows.length) {
    const values = rows.map(function (r) { return headers.map(function (h) { return r[h]; }); });
    sh.getRange(2, 1, values.length, headers.length).setValues(values);
  }
  const sym = getSetting_('currency_symbol', '₹');
  setColFormat_(sh, headers, 'fuel_cost', sym + '#,##0');
  setColFormat_(sh, headers, 'maint_cost', sym + '#,##0');
  setColFormat_(sh, headers, 'cumulative_maint', sym + '#,##0');
  setColFormat_(sh, headers, 'fuel_cost_per_km', sym + '0.00');
  setColFormat_(sh, headers, 'maint_cost_per_km', sym + '0.00');
  setColFormat_(sh, headers, 'total_cost_per_km', sym + '0.00');
  setColFormat_(sh, headers, 'efficiency_kmpl', '0.0');
  setColFormat_(sh, headers, 'km', '#,##0');
}

function setColFormat_(sh, headers, col, fmt) {
  const i = headers.indexOf(col) + 1;
  if (i > 0 && sh.getMaxRows() > 1) sh.getRange(2, i, sh.getMaxRows() - 1, 1).setNumberFormat(fmt);
}

// ---- The replace / keep signal --------------------------------------------

function computeWatchList_(byVehicle, regOf, settings) {
  const W = parseInt(settings.replace_window_months, 10) || 3;
  const risePct = parseFloat(settings.replace_maint_costkm_rise_pct) || 20;
  const dropPct = parseFloat(settings.replace_efficiency_drop_pct) || 10;
  const dtRise  = parseFloat(settings.replace_downtime_rise_days) || 2;
  const needAll = String(settings.replace_require_all_three).toLowerCase().indexOf('y') === 0;
  const lowEff  = parseFloat(settings.low_efficiency_kmpl); // NaN if blank

  const out = [];
  Object.keys(byVehicle).forEach(function (id) {
    const months = byVehicle[id];
    const recent = months.slice(-W);
    // A vehicle we could not measure at all recently cannot be trended.
    // It is reported separately rather than quietly passing as healthy.
    if (recent.length && recent.every(function (r) { return r.unmeasured; })) return;
    const prior  = months.slice(-2 * W, -W);
    const r = windowStats_(recent), p = windowStats_(prior);

    const reasons = [];
    var conditions = 0, comparable = prior.length > 0;

    if (comparable && p.maintCostKm > 0) {
      const rise = (r.maintCostKm - p.maintCostKm) / p.maintCostKm * 100;
      if (rise >= risePct) { conditions++; reasons.push('Maintenance ₹/km up ' + Math.round(rise) + '%'); }
    }
    if (comparable && p.eff > 0 && r.eff > 0) {
      const drop = (p.eff - r.eff) / p.eff * 100;
      if (drop >= dropPct) { conditions++; reasons.push('Efficiency down ' + Math.round(drop) + '%'); }
    }
    if (comparable) {
      const dt = r.downtime - p.downtime;
      if (dt >= dtRise) { conditions++; reasons.push('Downtime up ' + round2_(dt) + ' days'); }
    }

    var flagged = comparable && (needAll ? conditions === 3 : conditions >= 2);

    if (!isNaN(lowEff) && r.eff > 0 && r.eff < lowEff) {
      flagged = true;
      reasons.push('Below ' + lowEff + ' km/L');
    }

    if (flagged) {
      out.push({
        vehicle_id: id, reg_no: regOf[id] || id,
        reasons: reasons, score: conditions,
        recent_cost_per_km: round2_(r.totalCostKm),
        recent_kmpl: round2_(r.eff),
        recent_downtime: round2_(r.downtime)
      });
    }
  });
  out.sort(function (a, b) { return b.score - a.score || b.recent_cost_per_km - a.recent_cost_per_km; });
  return out;
}

/** Vehicles the replace signal had to skip because their meter was out of action. */
function computeUnassessable_(byVehicle, regOf, settings) {
  const W = parseInt(settings.replace_window_months, 10) || 3;
  const out = [];
  Object.keys(byVehicle).forEach(function (id) {
    const recent = byVehicle[id].slice(-W);
    if (recent.length && recent.every(function (r) { return r.unmeasured; })) {
      out.push({ vehicle_id: id, reg_no: regOf[id] || id, months: recent.length });
    }
  });
  return out;
}

/**
 * Fleet totals for one month. Vehicles whose meter was out of action are left
 * out of BOTH sides — counting their fuel spend against zero km would push the
 * fleet's cost/km up for a reason that has nothing to do with the vehicles.
 */
function monthTotals_(rows, mk) {
  var km = 0, cost = 0, blind = 0;
  rows.forEach(function (r) {
    if (r.month !== mk) return;
    if (r.unmeasured) { blind++; return; }
    km += r.km || 0;
    cost += (r.fuel_cost || 0) + (r.maint_cost || 0);
  });
  return { km: km, cost: cost, blind: blind, costPerKm: km > 0 ? round2_(cost / km) : 0 };
}

/** Vehicles currently off road, and vehicles whose odometer is out of action. */
function fleetStateLists_() {
  const today = new Date();
  const offRoad = [], odoDown = [];
  getRows_(SHEETS.VEHICLES).forEach(function (v) {
    if (isBlank_(v.vehicle_id) || String(v.status).toLowerCase() === 'retired') return;
    const reg = v.reg_no || v.vehicle_id;
    if (isOffRoad_(v)) {
      const since = parseDate_(v.off_road_since);
      offRoad.push({ vehicle_id: v.vehicle_id, reg_no: reg,
        since: since ? Utilities.formatDate(since, TZ_(), 'dd MMM yyyy') : '—',
        days: since ? daysBetween_(since, today) : null });
    }
    if (!odoWorks_(v)) {
      const b = parseDate_(v.odo_broken_since);
      odoDown.push({ vehicle_id: v.vehicle_id, reg_no: reg,
        since: b ? Utilities.formatDate(b, TZ_(), 'dd MMM yyyy') : '—',
        days: b ? daysBetween_(b, today) : null });
    }
  });
  offRoad.sort(function (a, b) { return (b.days || 0) - (a.days || 0); });
  odoDown.sort(function (a, b) { return (b.days || 0) - (a.days || 0); });
  return { offRoad: offRoad, odoDown: odoDown };
}

function windowStats_(rows) {
  var costKmSum = 0, costKmN = 0, effSum = 0, effN = 0, dt = 0, totalKmSum = 0, totalKmN = 0;
  rows.forEach(function (r) {
    if (r.maint_cost_per_km !== '') { costKmSum += r.maint_cost_per_km; costKmN++; }
    if (r.efficiency_kmpl !== '')   { effSum += r.efficiency_kmpl; effN++; }
    if (r.total_cost_per_km !== '') { totalKmSum += r.total_cost_per_km; totalKmN++; }
    dt += r.downtime_days || 0;
  });
  return {
    maintCostKm: costKmN ? costKmSum / costKmN : 0,
    eff: effN ? effSum / effN : 0,
    totalCostKm: totalKmN ? totalKmSum / totalKmN : 0,
    downtime: dt
  };
}

// ---- Upcoming document expiries -------------------------------------------

function upcomingExpiries_(regOf, settings) {
  const warnDays = parseInt(settings.doc_expiry_warning_days, 10) || 30;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  getRows_(SHEETS.DOCS).forEach(function (r) {
    const exp = parseDate_(r.expiry_date);
    if (!exp) return;
    const days = Math.round((exp - today) / 86400000);
    if (days <= warnDays) {
      out.push({
        reg_no: regOf[r.vehicle_id] || r.vehicle_id,
        doc_type: r.doc_type, number: r.number,
        expiry: Utilities.formatDate(exp, TZ_(), 'dd MMM yyyy'),
        daysLeft: days
      });
    }
  });
  out.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
  return out;
}

// ---- Dashboard payload for the web app ------------------------------------

function getDashboardData(token) {
  // needAdmin_() rather than a bespoke {error:'locked'} — it is the one contract
  // the client's handleAdminRes understands, so an expired session lands on the
  // unlock screen instead of printing "locked" into the page.
  if (!adminName_(token)) return needAdmin_();
  const result = computeSummaryRows_();
  const settings = getSettings();
  const watch = computeWatchList_(result.byVehicle, result.regOf, settings);
  const unassessable = computeUnassessable_(result.byVehicle, result.regOf, settings);
  const expiries = upcomingExpiries_(result.regOf, settings);
  const state = fleetStateLists_();

  const thisMonth = monthKey_(new Date());
  const totals = monthTotals_(result.rows, thisMonth);

  // Per-vehicle latest month figures (for the bar chart). Months with no
  // measured distance are carried through as unmeasured rather than as zero.
  const perVehicle = Object.keys(result.byVehicle).map(function (id) {
    const last = result.byVehicle[id][result.byVehicle[id].length - 1];
    return {
      vehicle_id: id, reg_no: last.reg_no, month: monthLabel_(last.month),
      cost_per_km: last.total_cost_per_km || 0, kmpl: last.efficiency_kmpl || 0,
      km: last.km || 0, unmeasured: !!last.unmeasured
    };
  }).sort(function (a, b) {
    return (a.unmeasured - b.unmeasured) || (b.cost_per_km - a.cost_per_km);
  });

  return {
    settings: settings,
    kpis: {
      activeVehicles: getRows_(SHEETS.VEHICLES).filter(function (v) {
        return String(v.status).toLowerCase() === 'active';
      }).length,
      offRoadCount: state.offRoad.length,
      odoDownCount: state.odoDown.length,
      kmThisMonth: round2_(totals.km),
      avgCostPerKm: totals.costPerKm,
      unmeasuredThisMonth: totals.blind,
      flaggedCount: watch.length,
      monthLabel: monthLabel_(thisMonth)
    },
    watch: watch,
    unassessable: unassessable,
    offRoad: state.offRoad,
    odoDown: state.odoDown,
    perVehicle: perVehicle,
    expiries: expiries
  };
}

// ---- Dashboard sheet (for people who prefer the spreadsheet) ---------------

function buildDashboard_(ss, result) {
  const sh = ss.getSheetByName(SHEETS.DASH) || ss.insertSheet(SHEETS.DASH);
  sh.clear();
  sh.getRange('A:Z').setVerticalAlignment('middle');
  sh.setHiddenGridlines(true);

  const settings = getSettings();
  const sym = settings.currency_symbol || '₹';
  const watch = computeWatchList_(result.byVehicle, result.regOf, settings);
  const unassessable = computeUnassessable_(result.byVehicle, result.regOf, settings);
  const expiries = upcomingExpiries_(result.regOf, settings);
  const state = fleetStateLists_();
  const thisMonth = monthKey_(new Date());

  const totals = monthTotals_(result.rows, thisMonth);
  const activeCount = getRows_(SHEETS.VEHICLES).filter(function (v) {
    return String(v.status).toLowerCase() === 'active';
  }).length;

  var row = 1;
  // Title
  sh.getRange(row, 1).setValue(settings.app_title || 'Fleet Dashboard')
    .setFontSize(18).setFontWeight('bold').setFontColor(PALETTE.lavenderText);
  sh.getRange(row + 1, 1).setValue('Updated ' + Utilities.formatDate(new Date(), TZ_(), 'dd MMM yyyy HH:mm'))
    .setFontColor('#8A8398');
  row += 3;

  // KPI cards
  const kpis = [
    ['Active vehicles', activeCount, PALETTE.sky],
    ['Off road', state.offRoad.length, state.offRoad.length ? PALETTE.warnAmber : PALETTE.mint],
    ['Km this month', Math.round(totals.km).toLocaleString(), PALETTE.mint],
    ['Avg cost / km', sym + totals.costPerKm, PALETTE.peach],
    ['Vehicles to watch', watch.length, watch.length ? PALETTE.flagRed : PALETTE.mint]
  ];
  kpis.forEach(function (k, i) {
    const c = 1 + i * 2;
    sh.getRange(row, c, 1, 2).merge().setValue(k[0]).setBackground(k[2])
      .setFontColor(PALETTE.headerText).setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(row + 1, c, 1, 2).merge().setValue(k[1]).setBackground(k[2])
      .setFontSize(20).setHorizontalAlignment('center');
  });
  sh.setRowHeight(row, 24); sh.setRowHeight(row + 1, 40);
  row += 2;
  if (totals.blind) {
    sh.getRange(row, 1, 1, 8).merge()
      .setValue('Note: ' + totals.blind + ' vehicle(s) left out of this month\'s km and cost/km — odometer not working.')
      .setFontColor('#8A8398');
  }
  row += 2;

  // Off road right now
  if (state.offRoad.length) {
    row = section_(sh, row, '🔧 Off road right now');
    tableHeader_(sh, row, ['Vehicle', 'Off road since', 'Days']); row++;
    state.offRoad.forEach(function (o) {
      sh.getRange(row, 1, 1, 3).setValues([[o.reg_no, o.since, o.days === null ? '—' : o.days]])
        .setBackground(PALETTE.warnAmber); row++;
    });
    row++;
  }

  // Odometers out of action
  if (state.odoDown.length) {
    row = section_(sh, row, '🚫 Odometer not working');
    sh.getRange(row, 1, 1, 8).merge()
      .setValue('Fuel and maintenance are still logged for these. Distance, cost/km and km/L pause until the meter is fixed.')
      .setFontColor('#8A8398');
    row++;
    tableHeader_(sh, row, ['Vehicle', 'Not working since', 'Days']); row++;
    state.odoDown.forEach(function (o) {
      sh.getRange(row, 1, 1, 3).setValues([[o.reg_no, o.since, o.days === null ? '—' : o.days]])
        .setBackground(PALETTE.warnAmber); row++;
    });
    row++;
  }

  // Watch list
  row = section_(sh, row, '🚨 Vehicles to watch');
  if (watch.length === 0) {
    sh.getRange(row, 1, 1, 6).merge().setValue('Nothing flagged — the fleet looks healthy.')
      .setBackground(PALETTE.okGreen); row += 2;
  } else {
    const head = ['Vehicle', 'Why', 'Recent cost/km', 'Recent km/L', 'Recent downtime'];
    tableHeader_(sh, row, head); row++;
    watch.forEach(function (w) {
      sh.getRange(row, 1, 1, 5).setValues([[
        w.reg_no, w.reasons.join('; '), sym + w.recent_cost_per_km, w.recent_kmpl, w.recent_downtime
      ]]).setBackground(PALETTE.flagRed); row++;
    });
    row++;
  }
  if (unassessable.length) {
    sh.getRange(row, 1, 1, 8).merge().setValue(
      'Could not be assessed (odometer out of action all window): ' +
      unassessable.map(function (u) { return u.reg_no; }).join(', ')
    ).setBackground(PALETTE.warnAmber);
    row += 2;
  }

  // Upcoming expiries
  row = section_(sh, row, '📄 Documents expiring soon');
  if (expiries.length === 0) {
    sh.getRange(row, 1, 1, 6).merge().setValue('No documents due in the warning window.')
      .setBackground(PALETTE.okGreen); row += 2;
  } else {
    tableHeader_(sh, row, ['Vehicle', 'Document', 'Number', 'Expires', 'Days left']); row++;
    expiries.forEach(function (e) {
      sh.getRange(row, 1, 1, 5).setValues([[e.reg_no, e.doc_type, e.number, e.expiry, e.daysLeft]])
        .setBackground(e.daysLeft < 0 ? PALETTE.flagRed : PALETTE.warnAmber); row++;
    });
    row++;
  }

  // Latest cost/km per vehicle (a simple in-sheet table; chart drawn below)
  row = section_(sh, row, '📊 Latest cost/km by vehicle');
  // Vehicles with no measured distance are listed after the chart, not as a
  // zero bar — a zero bar reads as "free to run".
  const all = Object.keys(result.byVehicle).map(function (id) {
    return result.byVehicle[id][result.byVehicle[id].length - 1];
  });
  const latest = all.filter(function (l) { return !l.unmeasured; })
    .map(function (l) { return [l.reg_no, l.total_cost_per_km || 0, l.efficiency_kmpl || 0, l.km || 0]; })
    .sort(function (a, b) { return b[1] - a[1]; });
  tableHeader_(sh, row, ['Vehicle', 'Cost/km', 'km/L', 'Km (latest month)']); row++;
  const chartTop = row;
  latest.forEach(function (r) {
    sh.getRange(row, 1, 1, 4).setValues([r]); row++;
  });
  const blindLatest = all.filter(function (l) { return l.unmeasured; });
  blindLatest.forEach(function (l) {
    sh.getRange(row, 1, 1, 4).setValues([[l.reg_no, '—', '—', 'odometer not working']])
      .setBackground(PALETTE.warnAmber); row++;
  });
  drawCostChart_(sh, chartTop, latest.length);

  for (var c = 1; c <= 10; c++) sh.setColumnWidth(c, 130);
}

function section_(sh, row, title) {
  sh.getRange(row, 1, 1, 6).merge().setValue(title)
    .setFontWeight('bold').setFontSize(13).setFontColor(PALETTE.lavenderText)
    .setBackground(PALETTE.band);
  return row + 1;
}

function tableHeader_(sh, row, head) {
  sh.getRange(row, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground(PALETTE.lavender).setFontColor(PALETTE.headerText);
}

function drawCostChart_(sh, topRow, n) {
  if (n < 1) return;
  try {
    sh.getCharts().forEach(function (ch) { sh.removeChart(ch); });
    const chart = sh.newChart()
      .setChartType(Charts.ChartType.BAR)
      .addRange(sh.getRange(topRow, 1, n, 1))   // vehicle
      .addRange(sh.getRange(topRow, 2, n, 1))   // cost/km
      .setOption('title', 'Cost per km (latest month)')
      .setOption('colors', ['#B7A6E0'])
      .setOption('legend', { position: 'none' })
      .setOption('height', Math.max(160, 40 + n * 28))
      .setOption('width', 460)
      .setPosition(topRow, 6, 0, 0)
      .build();
    sh.insertChart(chart);
  } catch (e) { /* charts are a bonus — never block the rebuild */ }
}
