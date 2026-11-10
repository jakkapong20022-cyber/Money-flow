'use strict';
const { db, save, uid } = require('./store');
const { HttpError, todayBkk, monthKey, monthRange, weekRange, isDate, parseAmount, fmt, bkkNow } = require('./util');
const { EXPENSE, INCOME, MEMBER_COLORS } = require('./defaults');

// ---------- families / seed ----------
function seedCategories(familyId) {
  const d = db();
  const add = (type, list) => list.forEach(([name, icon, color, subs], i) => {
    const id = uid('c_');
    d.categories.push({ id, familyId, type, name, icon, color, parentId: null, order: i });
    subs.forEach((s, j) => d.categories.push({ id: uid('c_'), familyId, type, name: s, icon, color, parentId: id, order: j }));
  });
  add('expense', EXPENSE); add('income', INCOME);
}

function createFamily(user, name, currency = '฿', memberNames) {
  const d = db();
  const f = {
    id: uid('f_'), name: name || 'ครอบครัวของเรา', currency, ownerId: user.id, createdAt: Date.now(),
    notify: { onAdd: true, budget: true, daily: false },
    line: { channelSecret: '', accessToken: '' },
  };
  d.families.push(f);
  user.familyId = f.id;
  seedCategories(f.id);
  (memberNames || []).forEach((m, i) => addMember(f.id, m, i));
  save();
  return f;
}

function addMember(familyId, m, idx = 0) {
  const d = db();
  const count = d.members.filter(x => x.familyId === familyId).length;
  const name = String(m.name || '').trim().slice(0, 30);
  if (!name) throw new HttpError(400, 'กรุณาใส่ชื่อสมาชิก');
  const mem = {
    id: uid('m_'), familyId, name, role: m.role || 'member', avatar: cleanAvatar(m.avatar, '🙂'),
    color: m.color || MEMBER_COLORS[(count + idx) % MEMBER_COLORS.length],
    budget: Number(m.budget) > 0 ? Number(m.budget) : 0, lineUserId: null, linkCode: null, linkExpires: 0,
  };
  d.members.push(mem); save();
  return mem;
}

// avatar = emoji (<=8 chars) or a small image data-URL (resized client-side to ~192px JPEG)
function cleanAvatar(a, fallback) {
  if (typeof a !== 'string' || !a) return fallback;
  if (a.startsWith('data:')) return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a) && a.length <= 120000 ? a : fallback;
  return a.slice(0, 8);
}
// Scanned slips: the image itself is never stored — only the extracted fields below.
function sanitizeSlip(s) {
  if (!s || typeof s !== 'object') return undefined;
  const out = {};
  for (const k of ['bank', 'sender', 'receiver', 'ref', 'time', 'memo']) if (s[k]) out[k] = String(s[k]).slice(0, 80);
  return Object.keys(out).length ? out : undefined;
}

// ---------- categories ----------
const catById = (id) => db().categories.find(c => c.id === id);
function mainCat(id) { const c = catById(id); if (!c) return null; return c.parentId ? catById(c.parentId) || c : c; }

const KEYWORDS = {
  expense: [
    ['อาหาร', /ข้าว|อาหาร|กิน|กาแฟ|ชา|ขนม|ก๋วยเตี๋ยว|ส้มตำ|หมู|ไก่|ปลา|ผลไม้|ร้าน|เดลิเวอรี่|grab ?food|lineman|foodpanda|7-?eleven|เซเว่น|โลตัส|lotus|แม็คโคร|makro|บิ๊กซี|big ?c|ตลาด|ต้มยำ|บุฟเฟ่|ชาบู|หมูกระทะ|starbucks|amazon/i],
    ['เดินทาง', /น้ำมัน|แท็กซี่|taxi|grab|bolt|รถ|bts|mrt|ทางด่วน|เดินทาง|ค่าโดยสาร|จอดรถ|ปตท|ptt|shell|บางจาก/i],
    ['สาธารณูปโภค', /ค่าไฟ|ค่าน้ำ|อินเทอร์เน็ต|เน็ต|ais|true|dtac|โทรศัพท์|มือถือ|การไฟฟ้า|ประปา|mea|pea|3bb|nt /i],
    ['การศึกษา', /เรียน|ค่าเทอม|โรงเรียน|หนังสือ|คอร์ส|กวดวิชา|ติว/i],
    ['บันเทิง', /หนัง|เกม|netflix|spotify|youtube|คอนเสิร์ต|เที่ยว|โรงแรม|ที่พัก|ตั๋ว/i],
    ['ช้อปปิ้ง', /เสื้อ|กางเกง|รองเท้า|shopee|lazada|ช้อป|กระเป๋า|เครื่องสำอาง/i],
    ['สุขภาพ', /ยา|หมอ|โรงพยาบาล|คลินิก|ฟัน|วิตามิน|รพ\./i],
    ['ลูก', /ลูก|นม|ผ้าอ้อม|ของเล่น/i],
    ['หนี้สิน', /หนี้|ผ่อน|บัตรเครดิต|งวด|กู้/i],
    ['ที่อยู่อาศัย', /ค่าเช่า|ผ่อนบ้าน|ผ่อนคอนโด|ซ่อม|นิติ/i],
  ],
  income: [
    ['เงินเดือน', /เงินเดือน|salary/i], ['โบนัส', /โบนัส|bonus/i],
    ['ธุรกิจ', /ขาย|กำไร|ค่าจ้าง|ฟรีแลนซ์|freelance|ลูกค้า/i], ['ดอกเบี้ย', /ดอกเบี้ย|ปันผล|dividend/i],
  ],
};

function guessCategory(familyId, type, text = '') {
  const cats = db().categories.filter(c => c.familyId === familyId && c.type === type);
  const t = String(text).toLowerCase();
  const fallback = () => cats.find(c => !c.parentId && c.name === 'อื่นๆ') || cats.find(c => !c.parentId);
  if (!t.trim()) return fallback();
  // 1) exact-ish name match (subcategory first, more specific)
  const named = cats.filter(c => c.parentId).concat(cats.filter(c => !c.parentId))
    .find(c => c.name.length >= 2 && !/^อื่นๆ$/.test(c.name) && c.name.split('/').some(p => p.length >= 2 && t.includes(p.toLowerCase())));
  if (named) return named;
  // 2) keyword rules -> main category (then try subcategory by name)
  for (const [mainName, re] of KEYWORDS[type]) {
    if (re.test(t)) {
      const main = cats.find(c => !c.parentId && c.name.includes(mainName));
      if (main) return main;
    }
  }
  return fallback();
}

// ---------- transactions ----------
function validateTxInput(familyId, b, partial = false) {
  const d = db();
  const out = {};
  if (!partial || b.type !== undefined) { if (!['income', 'expense'].includes(b.type)) throw new HttpError(400, 'ประเภทไม่ถูกต้อง'); out.type = b.type; }
  if (!partial || b.amount !== undefined) out.amount = parseAmount(b.amount);
  if (!partial || b.memberId !== undefined) {
    if (!d.members.some(m => m.id === b.memberId && m.familyId === familyId)) throw new HttpError(400, 'ไม่พบสมาชิก');
    out.memberId = b.memberId;
  }
  if (!partial || b.categoryId !== undefined) {
    const c = catById(b.categoryId);
    if (!c || c.familyId !== familyId) throw new HttpError(400, 'ไม่พบหมวดหมู่');
    out.categoryId = b.categoryId;
  }
  if (!partial || b.date !== undefined) {
    const dt = b.date || todayBkk();
    if (!isDate(dt)) throw new HttpError(400, 'วันที่ไม่ถูกต้อง');
    out.date = dt;
  }
  if (b.note !== undefined) out.note = String(b.note).slice(0, 300);
  return out;
}

function createTransaction(familyId, b, extra = {}) {
  const d = db();
  const v = validateTxInput(familyId, b);
  const cat = catById(v.categoryId);
  if (cat.type !== v.type) throw new HttpError(400, 'หมวดหมู่ไม่ตรงกับประเภทรายการ');
  const tx = { id: uid('t_'), familyId, note: '', source: 'app', ...v, ...extra, createdAt: Date.now() };
  d.transactions.push(tx); save();
  return tx;
}

function inRange(t, from, to) { return (!from || t.date >= from) && (!to || t.date <= to); }
const famTx = (familyId) => db().transactions.filter(t => t.familyId === familyId);

function totals(txs) {
  let income = 0, expense = 0;
  for (const t of txs) t.type === 'income' ? income += t.amount : expense += t.amount;
  return { income: round(income), expense: round(expense), net: round(income - expense) };
}
const round = (n) => Math.round(n * 100) / 100;

function byCategory(txs, type = 'expense') {
  const map = new Map();
  for (const t of txs) {
    if (t.type !== type) continue;
    const m = mainCat(t.categoryId); if (!m) continue;
    const e = map.get(m.id) || { id: m.id, name: m.name, icon: m.icon, color: m.color, amount: 0 };
    e.amount += t.amount; map.set(m.id, e);
  }
  const arr = [...map.values()].map(e => ({ ...e, amount: round(e.amount) })).sort((a, b) => b.amount - a.amount);
  const sum = arr.reduce((s, e) => s + e.amount, 0) || 1;
  arr.forEach(e => e.pct = Math.round(e.amount / sum * 1000) / 10);
  return arr;
}

function enrich(t) {
  const c = catById(t.categoryId), m = mainCat(t.categoryId);
  const mem = db().members.find(x => x.id === t.memberId);
  return { ...t, categoryName: c?.name, mainCategoryName: m?.name, icon: c?.icon, color: m?.color, memberName: mem?.name, memberAvatar: String(mem?.avatar || '').startsWith('data:') ? '' : mem?.avatar, memberColor: mem?.color };
}

function summary(familyId, month = monthKey()) {
  const d = db();
  const [from, to] = monthRange(month);
  const all = famTx(familyId);
  const mtx = all.filter(t => inRange(t, from, to));
  const tot = totals(mtx);
  const balance = totals(all).net;
  const totalExp = tot.expense || 0;
  const members = d.members.filter(m => m.familyId === familyId).map(m => {
    const mine = mtx.filter(t => t.memberId === m.id);
    const mt = totals(mine);
    return { id: m.id, name: m.name, avatar: m.avatar, color: m.color, budget: m.budget, spent: mt.expense, income: mt.income, pct: totalExp ? Math.round(mt.expense / totalExp * 100) : 0 };
  });
  const exp = byCategory(mtx);
  const budgets = d.categories.filter(c => c.familyId === familyId && !c.parentId && c.type === 'expense' && c.budget > 0)
    .map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, budget: c.budget, spent: exp.find(x => x.id === c.id)?.amount || 0 }));
  return { month, balance, income: tot.income, expense: tot.expense, net: tot.net, debtsSoon: listDebts(familyId).items.filter(x => x.status === 'active' && x.daysLeft <= 7).slice(0, 3).map(x => ({ id: x.id, name: x.name, dueDate: x.dueDate, daysLeft: x.daysLeft, amount: Math.min(x.installment || x.remaining, x.remaining) })), incomeCategories: byCategory(mtx, 'income'), budgets, members, categories: byCategory(mtx), recent: mtx.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map(enrich) };
}

function rangeFor(kind, from, to) {
  const today = todayBkk();
  if (kind === 'today') return [today, today];
  if (kind === 'week') return weekRange(today);
  if (kind === 'month') return monthRange(monthKey(today));
  if (kind === 'custom' && isDate(from) && isDate(to)) return [from, to];
  return monthRange(monthKey(today));
}

function memberStats(familyId, memberId, kind, from, to) {
  const m = db().members.find(x => x.id === memberId && x.familyId === familyId);
  if (!m) throw new HttpError(404, 'ไม่พบสมาชิก');
  const [f, t] = rangeFor(kind, from, to);
  const mine = famTx(familyId).filter(x => x.memberId === memberId);
  const [mf, mt] = monthRange(monthKey());
  const spentMonth = totals(mine.filter(x => inRange(x, mf, mt))).expense;
  const rng = mine.filter(x => inRange(x, f, t));
  return {
    member: { id: m.id, name: m.name, avatar: m.avatar, color: m.color, budget: m.budget, role: m.role },
    budget: m.budget, spentMonth, remaining: round(m.budget - spentMonth), pct: m.budget ? Math.round(spentMonth / m.budget * 1000) / 10 : 0,
    from: f, to: t, totals: totals(rng), categories: byCategory(rng),
    recent: rng.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 20).map(enrich),
  };
}

function report(familyId, kind, from, to, memberId) {
  const [f, t] = rangeFor(kind, from, to);
  let txs = famTx(familyId).filter(x => inRange(x, f, t));
  if (memberId) txs = txs.filter(x => x.memberId === memberId);
  // daily series
  const days = {};
  for (const x of txs) { const e = days[x.date] || (days[x.date] = { date: x.date, income: 0, expense: 0 }); e[x.type] += x.amount; }
  const series = Object.values(days).sort((a, b) => a.date.localeCompare(b.date)).map(e => ({ ...e, income: round(e.income), expense: round(e.expense) }));
  const mem = db().members.filter(m => m.familyId === familyId).map(m => {
    const tt = totals(txs.filter(x => x.memberId === m.id));
    return { id: m.id, name: m.name, avatar: m.avatar, color: m.color, ...tt };
  });
  return { from: f, to: t, totals: totals(txs), series, categories: byCategory(txs), incomeCategories: byCategory(txs, 'income'), members: mem, transactions: txs.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).map(enrich) };
}

// ---------- budget alerts ----------
// Returns a message if this expense pushed the member over 80% / 100% of their monthly budget (once per level per month).
function budgetAlert(familyId, memberId) {
  const m = db().members.find(x => x.id === memberId);
  if (!m || !m.budget) return null;
  const [f, t] = monthRange(monthKey());
  const spent = totals(famTx(familyId).filter(x => x.memberId === memberId && inRange(x, f, t))).expense;
  const pct = spent / m.budget * 100;
  const level = pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
  const key = monthKey();
  if (!level) return null;
  if (m.alertState && m.alertState.month === key && m.alertState.level >= level) return null;
  m.alertState = { month: key, level }; save();
  return level === 100
    ? `🚨 ${m.name} ใช้จ่ายเกินงบเดือนนี้แล้ว (${fmt(spent)}/${fmt(m.budget)} บาท)`
    : `⚠️ ${m.name} ใช้งบไปแล้ว ${Math.round(pct)}% (${fmt(spent)}/${fmt(m.budget)} บาท)`;
}


// ---------- debts (installments / loans with due dates) ----------
const isPhoto = (a) => typeof a === 'string' && a.startsWith('data:');
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
function addMonths(date, n, day) {
  const [y, m] = date.split('-').map(Number); const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = t % 12, last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
function money(v, label, req) {
  if (v === undefined || v === null || v === '') { if (req) throw new HttpError(400, `กรุณาใส่${label}`); return undefined; }
  const n = Number(String(v).replace(/,/g, '')); if (!(n >= 0) || n > 1e10) throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  return Math.round(n * 100) / 100;
}
function debtFields(familyId, b, creating) {
  const o = {};
  if (creating || b.name !== undefined) { const n = String(b.name || '').trim().slice(0, 60); if (!n) throw new HttpError(400, 'กรุณาใส่ชื่อหนี้'); o.name = n; }
  if (b.creditor !== undefined) o.creditor = String(b.creditor).trim().slice(0, 60);
  if (b.note !== undefined) o.note = String(b.note).trim().slice(0, 200);
  const pr = money(b.principal, 'ยอดหนี้ทั้งหมด', creating); if (pr !== undefined) o.principal = pr;
  const rm = money(b.remaining, 'ยอดคงเหลือ'); if (rm !== undefined) o.remaining = rm;
  const ins = money(b.installment, 'ค่างวด'); if (ins !== undefined) o.installment = ins;
  if (creating || b.kind !== undefined) o.kind = b.kind === 'once' ? 'once' : 'monthly';
  if (creating || b.dueDate !== undefined) { if (!isDate(b.dueDate)) throw new HttpError(400, 'วันครบกำหนดไม่ถูกต้อง'); o.dueDate = b.dueDate; o.dueDay = +b.dueDate.slice(8); }
  if (b.installmentsLeft !== undefined) { const n = (b.installmentsLeft === '' || b.installmentsLeft === null) ? 0 : parseInt(b.installmentsLeft, 10); if (!(n >= 0) || n > 1200) throw new HttpError(400, 'จำนวนงวดไม่ถูกต้อง'); o.installmentsLeft = n; }
  if (creating || b.remindDays !== undefined) { const n = parseInt(b.remindDays ?? 1, 10); o.remindDays = [0, 1, 3, 7].includes(n) ? n : 1; }
  if (b.memberId !== undefined) { if (b.memberId && !db().members.some(m => m.id === b.memberId && m.familyId === familyId)) throw new HttpError(400, 'ไม่พบสมาชิก'); o.memberId = b.memberId || ''; }
  return o;
}
function createDebt(familyId, b) {
  const o = debtFields(familyId, b, true);
  if (o.remaining === undefined) o.remaining = o.principal;
  if (o.kind === 'once' && o.installment === undefined) o.installment = o.remaining;
  const debt = { id: uid('d_'), familyId, creditor: '', note: '', installment: 0, installmentsLeft: 0, memberId: '', ...o, status: o.remaining > 0 ? 'active' : 'closed', payments: [], createdAt: Date.now() };
  db().debts.push(debt); save(); return debt;
}
function updateDebt(familyId, id, b) {
  const debt = db().debts.find(x => x.id === id && x.familyId === familyId); if (!debt) throw new HttpError(404, 'ไม่พบรายการหนี้');
  Object.assign(debt, debtFields(familyId, b, false));
  if (b.status === 'closed' || b.status === 'active') debt.status = b.status;
  if (debt.remaining <= 0) debt.status = 'closed'; else if (b.remaining !== undefined && debt.status === 'closed') debt.status = 'active';
  save(); return debt;
}
function deleteDebt(familyId, id) {
  const d = db(); if (!d.debts.some(x => x.id === id && x.familyId === familyId)) throw new HttpError(404, 'ไม่พบรายการหนี้');
  d.debts = d.debts.filter(x => x.id !== id); save();
}
function ensureDebtCategory(familyId) {
  const d = db(); const spec = EXPENSE.find(e => e[0].startsWith('หนี้สิน'));
  let c = d.categories.find(x => x.familyId === familyId && x.type === 'expense' && !x.parentId && x.name === spec[0]);
  if (!c) {
    c = { id: uid('c_'), familyId, type: 'expense', name: spec[0], icon: spec[1], color: spec[2], parentId: null, order: 98, budget: 0 };
    d.categories.push(c); spec[3].forEach((s, j) => d.categories.push({ id: uid('c_'), familyId, type: 'expense', name: s, icon: spec[1], color: spec[2], parentId: c.id, order: j }));
    save();
  }
  return c;
}
function decorateDebt(x, today = todayBkk()) {
  const daysLeft = x.status === 'active' ? daysBetween(today, x.dueDate) : null;
  const paidPct = x.principal > 0 ? Math.max(0, Math.min(100, Math.round((x.principal - x.remaining) / x.principal * 100))) : (x.status === 'closed' ? 100 : 0);
  const m = db().members.find(y => y.id === x.memberId);
  return { ...x, payments: x.payments.slice(-12), daysLeft, overdue: daysLeft !== null && daysLeft < 0, paidPct, memberName: m?.name || '' };
}
function listDebts(familyId) {
  const items = db().debts.filter(x => x.familyId === familyId).map(x => decorateDebt(x))
    .sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
  const act = items.filter(x => x.status === 'active');
  return { items, summary: {
    totalRemaining: round(act.reduce((s, x) => s + x.remaining, 0)),
    monthlyDue: round(act.filter(x => x.kind === 'monthly').reduce((s, x) => s + Math.min(x.installment || x.remaining, x.remaining), 0)),
    overdue: act.filter(x => x.overdue).length, dueSoon: act.filter(x => !x.overdue && x.daysLeft <= 7).length, active: act.length } };
}
function payDebt(familyId, id, b = {}) {
  const debt = db().debts.find(x => x.id === id && x.familyId === familyId); if (!debt) throw new HttpError(404, 'ไม่พบรายการหนี้');
  if (debt.status !== 'active') throw new HttpError(400, 'หนี้นี้ปิดแล้ว');
  const amount = parseAmount(b.amount ?? Math.min(debt.installment || debt.remaining, debt.remaining));
  const memberId = b.memberId || debt.memberId || db().members.find(m => m.familyId === familyId)?.id;
  const cat = ensureDebtCategory(familyId);
  const tx = createTransaction(familyId, { type: 'expense', amount, memberId, categoryId: cat.id, note: `ชำระหนี้: ${debt.name}`, date: b.date || todayBkk() }, { source: 'debt', debtId: debt.id });
  debt.remaining = round(Math.max(0, debt.remaining - amount));
  debt.payments.push({ date: tx.date, amount, txId: tx.id });
  if (debt.remaining <= 0) { debt.status = 'closed'; debt.installmentsLeft = 0; }
  else if (debt.kind === 'monthly') { debt.dueDate = addMonths(debt.dueDate, 1, debt.dueDay); if (debt.installmentsLeft > 0) debt.installmentsLeft -= 1; }
  save(); return { debt: decorateDebt(debt), transaction: enrich(tx) };
}

module.exports = { isPhoto, createDebt, updateDebt, deleteDebt, payDebt, listDebts, ensureDebtCategory, decorateDebt, daysBetween, addMonths, cleanAvatar, sanitizeSlip, createFamily, addMember, seedCategories, catById, mainCat, guessCategory, createTransaction, validateTxInput, famTx, totals, byCategory, enrich, summary, memberStats, report, budgetAlert, inRange, round };
