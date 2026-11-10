'use strict';
// Seed demo data through the public API. Usage: node test/seed.js http://localhost:3000  → prints token
const base = process.argv[2] || 'http://localhost:3000';
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const day = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
async function call(method, url, body, tok) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(url + ' ' + JSON.stringify(j)); return j;
}
(async () => {
  const { token } = await call('POST', '/api/register', { email: 'demo@family.test', password: 'demo1234', name: 'พ่อ' });
  await call('POST', '/api/family', { name: 'Family Budget', currency: '฿', members: [{ name: 'Dad', avatar: '👨' }, { name: 'Mom', avatar: '👩' }, { name: 'Child', avatar: '🧒' }] }, token);
  const me = await call('GET', '/api/me', null, token); const [dad, mom, kid] = me.members;
  const cats = await call('GET', '/api/categories', null, token);
  const c = (n) => cats.find(x => x.name === n).id;
  await call('PUT', `/api/members/${dad.id}`, { budget: 25000 }, token);
  await call('PUT', `/api/members/${mom.id}`, { budget: 20000 }, token);
  await call('PUT', `/api/members/${kid.id}`, { budget: 8000 }, token);
  const T = [
    ['income', 65000, dad, 'เงินเดือน', 'เงินเดือน', 9], ['income', 20000, mom, 'ธุรกิจ/ขายของ', 'ขายออนไลน์', 8],
    ['expense', 2450, mom, 'ของสด/ซูเปอร์มาร์เก็ต', 'Makro shopping', 1], ['expense', 1280, mom, 'ร้านอาหาร', 'Family dinner', 2],
    ['expense', 1890, mom, 'เสื้อผ้า', 'Clothes for kids', 3], ['expense', 8800, mom, 'ค่าไฟ', 'Electricity bill', 4],
    ['expense', 3200, dad, 'น้ำมัน', 'เติมน้ำมัน', 1], ['expense', 4500, dad, 'ค่าเช่า/ผ่อนบ้าน', 'ผ่อนบ้าน', 5], ['expense', 2400, dad, 'กาแฟ', 'กาแฟ', 6], ['expense', 5100, dad, 'ร้านอาหาร', 'เลี้ยงลูกค้า', 7],
    ['expense', 3500, kid, 'ค่าเทอม', 'ค่าเรียนพิเศษ', 3], ['expense', 1200, kid, 'คอร์สเรียน', 'คอร์สออนไลน์', 5], ['expense', 920, kid, 'เกม', 'เติมเกม', 2],
  ];
  for (const [type, amount, m, cat, note, ago] of T) await call('POST', '/api/transactions', { type, amount, memberId: m.id, categoryId: c(cat), note, date: day(Math.min(ago, +today.slice(8) - 1)) }, token);
  for (const [n, b] of [['อาหารและเครื่องดื่ม', 8000], ['การเดินทาง', 5000], ['ค่าสาธารณูปโภค', 9000], ['ช้อปปิ้ง', 3000], ['การศึกษา', 6000]]) await call('PUT', '/api/categories/' + c(n), { budget: b }, token);
  const due = (n) => day(-n);
  await call('POST', '/api/debts', { name: 'ผ่อนรถยนต์', creditor: 'ธนาคารกรุงศรี', principal: 480000, remaining: 312000, installment: 12000, dueDate: due(3), installmentsLeft: 26, remindDays: 3, memberId: dad.id }, token);
  await call('POST', '/api/debts', { name: 'บัตรเครดิต KTC', creditor: 'KTC', principal: 25000, remaining: 18400, installment: 2500, dueDate: due(-1), installmentsLeft: 8, memberId: mom.id }, token);
  await call('POST', '/api/debts', { name: 'ยืมเงินพี่ชาย', creditor: 'พี่ชาย', principal: 10000, kind: 'once', dueDate: due(20) }, token);
  console.log(token);
})().catch(e => { console.error(e); process.exit(1); });
