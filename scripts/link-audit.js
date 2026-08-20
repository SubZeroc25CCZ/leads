#!/usr/bin/env node
// Source-level link audit for LeadMachine landing pages.
// Prints every <a> and <button> and exits non-zero for placeholder or dead
// homepage fragment/local destinations. External checkout URLs are verified in
// the production audit separately because Stripe may reject HEAD requests.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pages = [
  { route: '/', file: 'site/index.html' },
  { route: '/partners', file: 'site/partners/index.html' },
];

let failures = 0;
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
};
const text = (tag) => tag.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
function localExists(href) {
  if (href === '/') return fs.existsSync(path.join(root, 'site/index.html'));
  const clean = href.replace(/^\//, '').replace(/[?#].*$/, '');
  if (!clean) return true;
  const candidates = [
    path.join(root, 'site', clean),
    path.join(root, 'site', clean, 'index.html'),
  ];
  return candidates.some(fs.existsSync);
}

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page.file), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/gi)].map((m) => m[1]));
  console.log(`\n${page.route} (${page.file})`);

  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map((m) => m[0]);
  for (const a of anchors) {
    const href = attr(a, 'href');
    const label = text(a) || '(unlabelled)';
    let status = 'live';
    if (!href || href === '#') status = 'DEAD: placeholder href';
    else if (href.startsWith('#') && !ids.has(href.slice(1))) status = `DEAD: no id="${href.slice(1)}" target`;
    else if (href.startsWith('/') && !localExists(href)) status = 'DEAD: local file/route missing';
    else if (/^javascript:/i.test(href)) status = 'DEAD: javascript URI';
    console.log(`A | ${label.padEnd(24)} | ${href.padEnd(68)} | ${status}`);
    if (status.startsWith('DEAD')) failures++;
  }

  const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)];
  for (const match of buttons) {
    const b = match[0];
    const label = text(b) || '(unlabelled)';
    const id = attr(b, 'id');
    const type = attr(b, 'type') || '(implicit submit)';
    // A submit control is valid when it appears between an opening and closing
    // form tag. Script controls have explicit ids and listeners in the page.
    const before = html.slice(0, match.index);
    const insideForm = before.lastIndexOf('<form') > before.lastIndexOf('</form>');
    const known = ['claim-btn', 'chat-toggle', 'chat-close'].includes(id) || insideForm;
    const status = known ? 'live: form/script control' : 'REVIEW: no obvious handler';
    console.log(`B | ${label.padEnd(24)} | id=${(id || '-').padEnd(16)} type=${type.padEnd(16)} | ${status}`);
    if (status.startsWith('REVIEW')) failures++;
  }
}

if (failures) {
  console.error(`\nFAILED: ${failures} dead or unresolved control(s).`);
  process.exit(1);
}
console.log('\nPASS: every source anchor resolves and every button has a known control path.');
