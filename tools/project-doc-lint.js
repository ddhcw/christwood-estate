'use strict';

const fs = require('node:fs');

const HEADER_KEYS = [
  'Slug',
  'Org',
  'Category',
  'Status',
  'Owner',
  'Contact if broken',
  'Tracker link',
  'Repo',
  'Doc status',
];

const HEADINGS = [
  'What it is',
  'Who uses it',
  'What it does',
  'Bindings',
  'Data it touches',
  'Triggers',
  'Config and secrets',
  'How to operate',
  'Known footguns',
  'Change history',
  'Could not verify',
];

const DOC_STATUS = /^\*\*Doc status:\*\*[ \t]*(?:Draft — not yet checked by a person|Checked by .+ on \d{4}-\d{2}-\d{2})[ \t]*$/m;
const RUNS_AS = /^\|\s*Runs as\s*\|\s*`?([^`|\s]+@[^`|\s]+)/mi;
const DEPLOYMENT_ID = /AKfycb[A-Za-z0-9_-]{40,}/;
const BANNED_WORDS = /\b(?:leverage|utilise|delve|holistic|journey|synergy)\b/i;

function lint(markdownText) {
  const errors = [];
  const warnings = [];
  const text = String(markdownText);

  if (!/^#\s+\S.*$/m.test(text)) errors.push('H1 missing');
  for (const key of HEADER_KEYS) {
    const match = text.match(new RegExp(`^\\*\\*${escapeRegExp(key)}:\\*\\*[ \\t]*(.*?)[ \\t]*$`, 'm'));
    if (!match) {
      errors.push(`header key missing: ${key}`);
    } else if (match[1].trim() === '') {
      errors.push(`header key empty: ${key}`);
    }
  }
  if (!DOC_STATUS.test(text)) errors.push('Doc status is invalid');

  const foundHeadings = findHeadings(text);
  if (foundHeadings.length !== HEADINGS.length || foundHeadings.some((heading, index) => heading !== HEADINGS[index])) {
    errors.push('the eleven ## headings are missing or out of order');
  }
  if (!RUNS_AS.test(text)) errors.push('Runs as row missing or invalid');
  if (DEPLOYMENT_ID.test(text)) errors.push('full deployment ID found');

  const lineCount = text === '' ? 0 : text.split(/\r?\n/).length;
  if (lineCount < 80 || lineCount > 200) warnings.push(`line count is ${lineCount}; expected 80–200`);
  if (BANNED_WORDS.test(text)) warnings.push('banned word found');

  return { errors, warnings };
}

function findHeadings(text) {
  const headings = [];
  let inFence = false;
  let fenceCharacter = '';
  let fenceLength = 0;
  let inComment = false;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    let visible = '';
    while (line.length > 0) {
      if (inComment) {
        const commentEnd = line.indexOf('-->');
        if (commentEnd === -1) line = '';
        else {
          inComment = false;
          line = line.slice(commentEnd + 3);
        }
        continue;
      }
      const commentStart = line.indexOf('<!--');
      if (commentStart === -1) {
        visible += line;
        line = '';
      } else {
        visible += line.slice(0, commentStart);
        line = line.slice(commentStart + 4);
        inComment = true;
      }
    }

    const fence = visible.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      const character = fence[1][0];
      const length = fence[1].length;
      if (!inFence) {
        inFence = true;
        fenceCharacter = character;
        fenceLength = length;
      } else if (character === fenceCharacter && length >= fenceLength) inFence = false;
      continue;
    }
    if (inFence) continue;

    const heading = visible.match(/^##[ \t]+(.*?\S)[ \t]*$/);
    if (heading) headings.push(heading[1]);
  }
  return headings;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (require.main === module) {
  let failed = false;
  for (const file of process.argv.slice(2)) {
    const result = lint(fs.readFileSync(file, 'utf8'));
    if (result.errors.length === 0) {
      console.log(`OK ${file}`);
    } else {
      failed = true;
      for (const error of result.errors) console.log(`FAIL ${file}: ${error}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

module.exports = { lint };
