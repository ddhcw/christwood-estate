'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lint } = require('./project-doc-lint');

const templatePath = path.join(__dirname, '..', 'docs', 'templates', 'PROJECT.md');
const valid = fs.readFileSync(templatePath, 'utf8');

function errorsFor(mutated) {
  return lint(mutated).errors;
}

assert.deepEqual(lint(valid).errors, []);
assert.equal(lint(valid).warnings.length, 0);

assert.ok(errorsFor(valid.replace(/^# Example Project$/m, 'Example Project')).includes('H1 missing'));
for (const key of ['Slug', 'Org', 'Category', 'Status', 'Owner', 'Contact if broken', 'Tracker link', 'Repo', 'Doc status']) {
  const keyPattern = new RegExp(`^\\*\\*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}:\\*\\*.*$`, 'm');
  assert.ok(errorsFor(valid.replace(keyPattern, '')).includes(`header key missing: ${key}`));
  assert.ok(errorsFor(valid.replace(keyPattern, `**${key}:**`)).includes(`header key empty: ${key}`));
}
assert.ok(errorsFor(valid.replace(/^\*\*Doc status:\*\*.*$/m, '**Doc status:** Maybe')).includes('Doc status is invalid'));
assert.deepEqual(lint(valid.replace(/^\*\*Doc status:\*\*.*$/m, '**Doc status:** Checked by Stella on 2026-10-20')).errors, []);
assert.ok(errorsFor(valid.replace(/^\*\*Doc status:\*\*.*$/m, '**Doc status:** Draft - not yet checked by a person')).includes('Doc status is invalid'));
assert.ok(errorsFor(valid.replace(/^## Triggers$/m, '## Missing heading')).includes('the eleven ## headings are missing or out of order'));
const swapped = valid.replace(/^## Who uses it$/m, '## TEMP HEADING').replace(/^## Triggers$/m, '## Who uses it').replace(/^## TEMP HEADING$/m, '## Triggers');
assert.ok(errorsFor(swapped).includes('the eleven ## headings are missing or out of order'));
const ignoredHeadings = `${valid.replace(/^## Triggers$/m, '## Triggers  ')}\n\n\`\`\`\n## Fake code heading\n\`\`\`\n<!--\n## Fake comment heading\n-->`;
assert.deepEqual(lint(ignoredHeadings).errors, []);
assert.ok(errorsFor(valid.replace(/^\| Runs as \|.*$/m, '| Run as | nobody@example.test |')).includes('Runs as row missing or invalid'));
assert.ok(errorsFor(`${valid}\nAKfycb${'a'.repeat(40)}`).includes('full deployment ID found'));

assert.ok(lint('short').warnings.some((warning) => warning.startsWith('line count')));
assert.ok(lint(`${valid}\n<!-- synergy -->`).warnings.includes('banned word found'));
assert.ok(lint(`${valid}\n${'x\n'.repeat(201)}`).warnings.some((warning) => warning.startsWith('line count')));

console.log('all passed');
