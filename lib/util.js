'use strict';
const crypto = require('crypto');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---- dates (Asia/Bangkok, UTC+7) ----
const bkkNow = () => new Date(Date.now() + 7 * 3600e3);
const todayBkk = () => bkkNow().toISOString().slice(0, 10);
const monthKey = (d = todayBkk()) => d.slice(0, 7);
function monthRange(m) {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, '0')}`];
}
function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function weekRange(d = todayBkk()) {
  const dow = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday=0
  const from = addDays(d, -dow);
  return [from, addDays(from, 6)];
}
const dmy = (d) => String(d).split('-').reverse().join('/');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s + 'T00:00:00Z'));

// ---- passwords / tokens ----
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  const h = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return h.length === b.length && crypto.timingSafeEqual(h, b);
}
const newToken = () => crypto.randomBytes(32).toString('hex');

// ---- numbers ----
function parseAmount(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,฿\s]/g, ''));
  if (!isFinite(n) || n <= 0 || n > 1e9) throw new HttpError(400, 'จำนวนเงินไม่ถูกต้อง');
  return Math.round(n * 100) / 100;
}
const fmt = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

module.exports = { HttpError, bkkNow, todayBkk, monthKey, monthRange, addDays, dmy, weekRange, isDate, hashPassword, verifyPassword, newToken, parseAmount, fmt };
