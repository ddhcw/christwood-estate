'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IST_OFFSET_MINUTES = 330;
const MINUTES_PER_WEEK = 7 * 24 * 60;
const ISO_OFFSET_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DAYS = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function parsePoint(point) {
  if (!asObject(point)) return null;
  if (typeof point.day !== 'string' || !Object.prototype.hasOwnProperty.call(DAYS, point.day)) return null;
  const time = parseTime(point.time);
  if (time === null) return null;
  return DAYS[point.day] * 24 * 60 + time;
}

function selectedWindows(config) {
  if (Array.isArray(config && config.windows) && config.windows.length > 0) {
    return config.windows;
  }
  if (config && config.weekly_window) {
    return [{ ...config.weekly_window, name: 'weekly' }];
  }
  return [];
}

function intervalSegments(window) {
  if (!asObject(window)) return [];
  const start = parsePoint(window.start);
  const end = parsePoint(window.end);
  if (start === null || end === null || start === end) return [];
  if (end > start) return [[start, end]];
  return [[start, MINUTES_PER_WEEK], [0, end]];
}

function validateWindow(window, label) {
  const errors = [];
  if (!asObject(window)) return [`${label} must be an object`];

  for (const edge of ['start', 'end']) {
    const point = window[edge];
    if (!asObject(point) || typeof point.day !== 'string' ||
        !Object.prototype.hasOwnProperty.call(DAYS, point.day)) {
      errors.push(`${label} ${edge} day must be a day name`);
    }
    if (!asObject(point) || parseTime(point.time) === null) {
      errors.push(`${label} ${edge} time must be HH:MM`);
    }
  }

  const start = parsePoint(window.start);
  const end = parsePoint(window.end);
  if (start !== null && end !== null && start === end) {
    errors.push(`${label} start and end cannot be the same`);
  }
  return errors;
}

function validate(config) {
  const errors = [];
  if (!asObject(config)) return ['config must be an object'];

  if (config.windows !== undefined && !Array.isArray(config.windows)) {
    errors.push('windows must be an array');
  }

  const hasUsableWindows = Array.isArray(config.windows) && config.windows.length > 0;
  if (!hasUsableWindows && !config.weekly_window) {
    errors.push('missing both windows and weekly_window');
  }

  const windows = selectedWindows(config);
  const seenNames = new Set();
  windows.forEach((window, index) => {
    if (asObject(window)) {
      if (typeof window.name !== 'string' || window.name.trim() === '') {
        errors.push(`window ${index + 1} name must be a non-empty string`);
      } else if (seenNames.has(window.name)) {
        errors.push(`duplicate window name ${window.name}`);
      } else {
        seenNames.add(window.name);
      }
    }
    errors.push(...validateWindow(window, asObject(window) && typeof window.name === 'string' && window.name
      ? `window ${window.name}`
      : `window ${index + 1}`));
  });

  for (let left = 0; left < windows.length; left += 1) {
    for (let right = left + 1; right < windows.length; right += 1) {
      const overlaps = intervalSegments(windows[left]).some(([leftStart, leftEnd]) =>
        intervalSegments(windows[right]).some(([rightStart, rightEnd]) =>
          leftStart < rightEnd && rightStart < leftEnd));
      if (overlaps) {
        const leftName = asObject(windows[left]) && typeof windows[left].name === 'string' && windows[left].name || `window ${left + 1}`;
        const rightName = asObject(windows[right]) && typeof windows[right].name === 'string' && windows[right].name || `window ${right + 1}`;
        errors.push(`windows ${leftName} and ${rightName} overlap`);
      }
    }
  }

  if (config.override_until !== null && config.override_until !== undefined) {
    if (typeof config.override_until !== 'string' || !parseUtc(config.override_until)) {
      errors.push('override_until must be an ISO-8601 timestamp or null');
    }
  }
  return errors;
}

function parseUtc(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value !== 'string') return null;
  const match = ISO_OFFSET_TIMESTAMP.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const zone = match[7];
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== 'Z') {
    if (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59) return null;
  }
  // Wall-clock round trip: JS Date rolls impossible days forward (Nov 31 -> Dec 1).
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  wall.setUTCFullYear(year);
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day ||
      wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localParts(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds()
  };
}

function localNaiveDate(parts) {
  return new Date(Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  ));
}

function minuteOfWeek(parts) {
  return parts.weekday * 24 * 60 + parts.hour * 60 + parts.minute +
    parts.second / 60 + parts.millisecond / 60000;
}

function formatNaiveIst(date) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}+05:30`;
}

function formatUtcAsIst(date) {
  return formatNaiveIst(localNaiveDate(localParts(date)));
}

function windowTiming(window) {
  if (!asObject(window)) return null;
  const start = parsePoint(window.start);
  const end = parsePoint(window.end);
  if (start === null || end === null || start === end) return null;
  const duration = (end - start + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  return { start, end, duration };
}

function activeWindow(windows, nowDate) {
  const parts = localParts(nowDate);
  const current = minuteOfWeek(parts);
  for (const window of windows) {
    const timing = windowTiming(window);
    if (!timing) continue;
    const elapsed = (current - timing.start + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
    if (elapsed < timing.duration) return { window, timing, elapsed, parts };
  }
  return null;
}

function nextStart(windows, nowDate) {
  const parts = localParts(nowDate);
  const nowNaive = localNaiveDate(parts);
  const current = minuteOfWeek(parts);
  let best = null;

  for (const window of windows) {
    const timing = windowTiming(window);
    if (!timing) continue;
    let minutesAhead = (timing.start - current + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
    if (minutesAhead === 0) minutesAhead = MINUTES_PER_WEEK;
    const candidate = new Date(nowNaive.getTime() + minutesAhead * 60 * 1000);
    if (!best || candidate < best) best = candidate;
  }
  return best ? formatNaiveIst(best) : null;
}

function isOpen(config, nowUtc) {
  const warnings = [];
  // Fail closed: the enable flag is checked first, before anything else can throw or complain.
  if (config === null || typeof config !== 'object' || config.agent_enabled !== true) {
    return { open: false, window: null, reason: 'agent disabled', nextStart: null, warnings };
  }
  let now = null;
  try {
    now = parseUtc(nowUtc === undefined ? new Date() : nowUtc);
  } catch (error) {
    now = null;
  }
  if (!now) {
    return { open: false, window: null, reason: 'invalid now', nextStart: null, warnings };
  }
  const configErrors = validate(config);
  if (configErrors.length > 0) {
    const overrideError = configErrors.some(error => error.includes('override_until'));
    return {
      open: false,
      window: null,
      reason: overrideError ? 'invalid override_until' : 'invalid config',
      nextStart: null,
      warnings
    };
  }
  let override = null;
  if (typeof config?.override_until === 'string') {
    override = parseUtc(config.override_until);
    if (override && override <= now) warnings.push('override expired, ignored');
  }

  if (override && override > now) {
    return { open: true, window: 'override', reason: 'override', nextStart: null, warnings };
  }

  const windows = selectedWindows(config);
  const active = activeWindow(windows, now);
  if (active) {
    return { open: true, window: active.window.name || 'weekly', reason: 'inside window', nextStart: null, warnings };
  }
  return {
    open: false,
    window: null,
    reason: 'outside window',
    nextStart: nextStart(windows, now),
    warnings
  };
}

function scheduleEnd(windows, now) {
  const active = activeWindow(windows, now);
  if (!active) return null;
  const nowNaive = localNaiveDate(active.parts);
  const startNaive = new Date(nowNaive.getTime() - active.elapsed * 60 * 1000);
  return formatNaiveIst(new Date(startNaive.getTime() + active.timing.duration * 60 * 1000));
}

function cli() {
  const args = process.argv.slice(2);
  let configPath = path.resolve(__dirname, '..', '.claude', 'agent-window.json');
  let nowValue;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--config' && args[index + 1]) configPath = path.resolve(process.cwd(), args[++index]);
    else if (args[index] === '--now' && args[index + 1]) nowValue = args[++index];
    else {
      console.error('Usage: node tools/window-check.js [--config <path>] [--now <ISO-8601 UTC>]');
      process.exitCode = 2;
      return;
    }
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error(`Invalid config: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const now = nowValue === undefined ? new Date() : parseUtc(nowValue);
  if (!now) {
    console.error('Invalid --now: expected an ISO-8601 time');
    process.exitCode = 2;
    return;
  }
  if (config === null || typeof config !== 'object' || config.agent_enabled !== true) {
    console.log('CLOSED agent disabled');
    process.exitCode = 1;
    return;
  }
  const errors = validate(config);
  if (errors.length > 0) {
    errors.forEach(error => console.error(`Invalid config: ${error}`));
    process.exitCode = 2;
    return;
  }
  const result = isOpen(config, now);
  result.warnings.forEach(warning => console.log(`WARNING ${warning}`));
  if (!result.open) {
    if (result.reason === 'agent disabled') console.log('CLOSED agent disabled');
    else console.log(`CLOSED outside window; next ${result.nextStart ? `${nextWindowName(config, now)} ${result.nextStart}` : 'window unavailable'}`);
    process.exitCode = 1;
    return;
  }

  let until;
  if (result.window === 'override') until = formatUtcAsIst(parseUtc(config.override_until));
  else until = scheduleEnd(selectedWindows(config), now);
  console.log(`OPEN ${result.window} until ${until}`);
  process.exitCode = 0;
}

function nextWindowName(config, now) {
  const windows = selectedWindows(config);
  const parts = localParts(now);
  const current = minuteOfWeek(parts);
  let best = null;
  for (const window of windows) {
    const timing = windowTiming(window);
    if (!timing) continue;
    let minutesAhead = (timing.start - current + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
    if (minutesAhead === 0) minutesAhead = MINUTES_PER_WEEK;
    if (!best || minutesAhead < best.minutesAhead) best = { minutesAhead, name: window.name || 'weekly' };
  }
  return best ? best.name : 'window';
}

module.exports = { isOpen, validate };

if (require.main === module) cli();
