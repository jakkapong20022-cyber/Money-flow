'use strict';
// Tiny JSON-file datastore (atomic writes, debounced). Fine for a household-sized app.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const empty = () => ({ users: [], sessions: {}, families: [], members: [], categories: [], transactions: [], debts: [], accessCodes: [] });
let db = empty();
try { db = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (_) { /* first run */ }

let timer = null;
function save() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 150);
}
function flush() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
process.on('exit', () => { if (timer) flush(); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { flush(); process.exit(0); });

const uid = (p = '') => p + crypto.randomBytes(8).toString('hex');

module.exports = { db: () => db, save, flush, uid, replaceAll: (d) => { db = Object.assign(empty(), d); flush(); } };
