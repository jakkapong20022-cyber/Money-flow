'use strict';
// End-to-end test: API + LINE webhook (dry-run, mocked OCR). Run: node test/test.js
const os = require('os'), path = require('path'), fs = require('fs'), crypto = require('crypto'), assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));
process.env.LINE_DRY_RUN = '1';
process.env.OCR_MOCK = '1';
const server = require('../server');
const line = require('../lib/line');

let base, token, pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓', m); };
async function call(method, url, body, tok = token, headers = {}) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j };
}
const SECRET = 'testsecret';
async function lineEvent(familyId, events, secret = SECRET) {
  const raw = JSON.stringify({ events });
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const r = await fetch(`${base}/webhook/line/${familyId}`, { method: 'POST', headers: { 'x-line-signature': sig, 'content-type': 'application/json' }, body: raw });
  await new Promise(r => setTimeout(r, 120)); // handler runs after ack
  return r.status;
}
const evText = (uid, t) => ({ type: 'message', replyToken: 'rt', source: { userId: uid }, message: { type: 'text', id: '1', text: t } });
const lastReply = () => { const o = line.outbox; return o[o.length - 1]?.body?.messages?.[0]?.text || ''; };

(async () => {
  await new Promise(r => server.listen(0, r)); base = 'http://127.0.0.1:' + server.address().port;

  console.log('Auth & setup');
  let r = await call('POST', '/api/register', { email: 'a@b.com', password: '123456', name: 'พ่อ' }, null);
  ok(r.status === 201, 'register'); token = r.body.token;
  ok((await call('POST', '/api/register', { email: 'a@b.com', password: '123456' }, null)).status === 409, 'duplicate email rejected');
  ok((await call('POST', '/api/login', { email: 'a@b.com', password: 'wrong' }, null)).status === 401, 'bad password rejected');
  ok((await call('GET', '/api/summary', null, 'nope')).status === 401, 'unauthenticated blocked');
  r = await call('POST', '/api/family', { name: 'บ้านสุขสันต์', currency: '฿', members: [{ name: 'พ่อ', avatar: '👨' }, { name: 'แม่', avatar: '👩' }, { name: 'ลูก', avatar: '🧒' }] });
  ok(r.status === 201, 'create family'); const famId = r.body.id;
  const me = (await call('GET', '/api/me')).body;
  ok(me.members.length === 3, '3 members'); const [dad, mom, kid] = me.members;
  const cats = (await call('GET', '/api/categories')).body;
  ok(cats.filter(c => c.type === 'expense' && !c.parentId).length >= 9 && cats.some(c => c.parentId), 'default categories + subcategories seeded');
  const food = cats.find(c => c.name === 'อาหารและเครื่องดื่ม'), salary = cats.find(c => c.name === 'เงินเดือน');

  console.log('Transactions & reports');
  r = await call('POST', '/api/transactions', { type: 'income', amount: 85000, memberId: dad.id, categoryId: salary.id, note: 'เงินเดือน' });
  ok(r.status === 201, 'add income');
  r = await call('POST', '/api/transactions', { type: 'expense', amount: '1,250', memberId: mom.id, categoryId: cats.find(c => c.name === 'ร้านอาหาร').id, note: 'ข้าว' });
  ok(r.status === 201 && r.body.amount === 1250 && r.body.mainCategoryName === 'อาหารและเครื่องดื่ม', 'add expense (comma amount, sub→main rollup)');
  ok((await call('POST', '/api/transactions', { type: 'expense', amount: -5, memberId: mom.id, categoryId: food.id })).status === 400, 'negative amount rejected');
  ok((await call('POST', '/api/transactions', { type: 'income', amount: 5, memberId: mom.id, categoryId: food.id })).status === 400, 'type/category mismatch rejected');
  const s = (await call('GET', '/api/summary')).body;
  ok(s.income === 85000 && s.expense === 1250 && s.balance === 83750, 'summary totals');
  ok(s.members.find(x => x.id === mom.id).pct === 100, 'member share of expenses');
  ok((await call('GET', `/api/report?range=month&member=${mom.id}`)).body.totals.expense === 1250, 'report filtered by member');
  ok((await call('PUT', `/api/members/${mom.id}`, { budget: 2000 })).status === 200, 'set member budget');
  const st = (await call('GET', `/api/members/${mom.id}/stats?range=today`)).body;
  ok(st.pct === 62.5 && st.remaining === 750, 'member stats: budget ring 62.5%');

  console.log('Categories');
  r = await call('POST', '/api/categories', { type: 'expense', name: 'สัตว์เลี้ยง', icon: '🐶', color: '#ff00aa' });
  ok(r.status === 201, 'add main category');
  r = await call('POST', '/api/categories', { parentId: r.body.id, name: 'อาหารหมา' });
  ok(r.status === 201 && r.body.color === '#ff00aa', 'add sub-category inherits color');
  ok((await call('DELETE', `/api/categories/${food.id}`)).status === 409, 'delete category in use is blocked');

  console.log('LINE OA');
  await call('PUT', '/api/family', { line: { channelSecret: SECRET, accessToken: 'tok' } });
  ok((await call('GET', '/api/me')).body.family.line.configured, 'LINE configured');
  ok(await lineEvent(famId, [evText('Umom', 'x')], 'wrong') === 401, 'webhook rejects bad signature');
  line.outbox = [];
  await lineEvent(famId, [evText('Umom', 'จ่าย 100 ข้าว')]);
  ok(/ผูกบัญชี|ยังไม่ได้ผูก/.test(lastReply()), 'unlinked user asked to link');
  const lc = (await call('POST', `/api/members/${mom.id}/linkcode`)).body;
  ok(lc.url === '' && /^\d{6}$/.test(lc.code), 'link code has no QR url until OA ID is known');
  r = await call('PUT', '/api/family', { line: { basicId: '@bad id!' } }); ok(r.status === 400, 'invalid LINE ID rejected');
  r = await call('PUT', '/api/family', { line: { basicId: '@moneyflow1' } }); ok(r.body.line.basicId === 'moneyflow1', 'LINE ID saved without @');
  const lc2 = (await call('POST', `/api/members/${mom.id}/linkcode`)).body; const code = lc2.code;
  ok(lc2.url === 'https://line.me/R/oaMessage/%40moneyflow1/?' + encodeURIComponent('ผูก ' + code), 'QR url = oaMessage deep link with prefilled "ผูก code"');
  ok(lc2.addUrl === 'https://line.me/R/ti/p/%40moneyflow1', 'add-friend url');
  const QR = require('../public/qr.js'); const qq = QR.encode(lc2.url); ok(qq.size >= 21 && /<svg/.test(QR.svg(lc2.url)), 'QR encoder renders link');
  await lineEvent(famId, [evText('Umom', 'ผูก 000000')]); ok(/ไม่ถูกต้อง/.test(lastReply()), 'wrong link code rejected');
  await lineEvent(famId, [evText('Umom', 'ผูก ' + code)]); ok(/ผูกบัญชีสำเร็จ.*แม่/s.test(lastReply()), 'link LINE user → member');
  const dadCode = (await call('POST', `/api/members/${dad.id}/linkcode`)).body.code;
  await lineEvent(famId, [evText('Udad', 'ผูก ' + dadCode)]);

  line.outbox = [];
  await lineEvent(famId, [evText('Umom', 'จ่าย 120 ก๋วยเตี๋ยว')]);
  ok(/บันทึกรายจ่าย.*120/s.test(lastReply()), 'text command: expense saved');
  ok(line.outbox.some(o => o.body.to === 'Udad' && /แม่.*120/.test(o.body.messages[0].text)), 'other members notified via push');
  ok(!line.outbox.some(o => o.body.to === 'Umom' && /💸/.test(o.body.messages[0].text)), 'actor not double-notified');
  await lineEvent(famId, [evText('Umom', 'รับ 500 ขายของ')]);
  ok(/รายรับ/.test(lastReply()), 'text command: income saved');
  await lineEvent(famId, [evText('Umom', 'กาแฟ 65')]);
  ok(/บันทึกรายจ่าย.*65/s.test(lastReply()), 'shorthand "กาแฟ 65"');
  await lineEvent(famId, [evText('Umom', 'ลบล่าสุด')]); ok(/ลบแล้ว/.test(lastReply()), 'undo last');
  await lineEvent(famId, [evText('Umom', 'สรุป')]); ok(/สรุปเดือน/.test(lastReply()), 'summary command');

  console.log('Slip scanning');
  line.outbox = [];
  const img = { type: 'message', replyToken: 'rt', source: { userId: 'Umom' }, message: { type: 'image', id: '99' } };
  const before = (await call('GET', '/api/summary')).body.expense;
  await lineEvent(famId, [img]);
  ok(/สแกนสลิปสำเร็จ.*1,?250/s.test(lastReply()), 'LINE slip image → transaction');
  ok(line.outbox.some(o => /เกินงบ|ใช้งบ/.test(o.body.messages[0].text)), 'budget alert triggered (>80% of 2,000)');
  ok((await call('GET', '/api/summary')).body.expense === before + 1250, 'slip amount added to expenses');
  const sc = await call('POST', '/api/slip/scan', { image: Buffer.from('x').toString('base64'), mime: 'image/png' });
  ok(sc.status === 200 && sc.body.amount === 1250 && sc.body.categoryId, 'web slip scan returns prefilled draft');
  const ref = 'DUP123'; process.env.OCR_MOCK = JSON.stringify({ is_slip: true, amount: 300, date: '2569-11-10', ref, receiver: 'ร้านกาแฟ', type: 'expense' });
  await lineEvent(famId, [img]); ok(/สแกนสลิปสำเร็จ/.test(lastReply()) && /10\/11\/2026/.test(lastReply()), 'Buddhist-era date normalised (2569→2026)');
  await lineEvent(famId, [img]); ok(/เคยบันทึกแล้ว/.test(lastReply()), 'duplicate slip detected by ref');
  process.env.OCR_MOCK = JSON.stringify({ is_slip: false });
  await lineEvent(famId, [img]); ok(/ไม่พบยอดเงิน/.test(lastReply()), 'non-slip image handled');
  process.env.OCR_MOCK = '1';


  console.log('Debts, calendar, photo avatar, category budget, slip data');
  const ICS = require('../public/ics.js');
  const due = (n) => { const d = new Date(Date.now() + 7 * 3600e3 + n * 864e5); return d.toISOString().slice(0, 10); };
  r = await call('POST', '/api/debts', { name: 'ผ่อนรถ', creditor: 'ธนาคาร A', principal: 120000, remaining: 100000, installment: 5000, dueDate: due(2), installmentsLeft: 20, remindDays: 3, memberId: dad.id });
  ok(r.status === 201 && r.body.daysLeft === 2 && r.body.paidPct === 17, 'create debt (days left, paid %)');
  const debtId = r.body.id;
  ok((await call('POST', '/api/debts', { name: '', principal: 1, dueDate: due(1) })).status === 400, 'debt requires name');
  ok((await call('POST', '/api/debts', { name: 'x', principal: 1, dueDate: 'nope' })).status === 400, 'debt requires valid due date');
  await call('POST', '/api/debts', { name: 'บัตรเครดิต', principal: 8000, installment: 8000, kind: 'once', dueDate: due(-3) });
  let dl = (await call('GET', '/api/debts')).body;
  ok(dl.items.length === 2 && dl.summary.overdue === 1 && dl.summary.totalRemaining === 108000, 'debt list: overdue + totals');
  ok(/\/calendar\/[a-f0-9]{32}\.ics$/.test(dl.feed), 'calendar feed URL issued');
  const home = (await call('GET', '/api/summary')).body;
  ok(home.debtsSoon.length === 2 && home.debtsSoon[0].daysLeft <= 2, 'home summary lists debts due soon');
  const calRes = await fetch(dl.feed.replace(/^https?:\/\/[^/]+/, base));
  const ics = await calRes.text();
  ok(calRes.headers.get('content-type').startsWith('text/calendar') && /BEGIN:VEVENT/.test(ics) && /RRULE:FREQ=MONTHLY;COUNT=20/.test(ics) && /TRIGGER:-P3D/.test(ics), 'public .ics feed: event + monthly RRULE + 3-day alarm');
  ok(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75), '.ics lines folded ≤ 75 octets');
  ok((await fetch(base + '/calendar/' + '0'.repeat(32) + '.ics')).status === 404, 'unknown calendar token → 404');
  const before2 = (await call('GET', '/api/summary')).body.expense;
  r = await call('POST', `/api/debts/${debtId}/pay`, { memberId: dad.id });
  ok(r.status === 200 && r.body.debt.remaining === 95000 && r.body.debt.installmentsLeft === 19 && r.body.debt.dueDate > due(20), 'pay installment: balance↓, due date +1 month, installments↓');
  ok((await call('GET', '/api/summary')).body.expense === before2 + 5000, 'payment recorded as expense transaction');
  ok(r.body.transaction.mainCategoryName === 'หนี้สิน/ผ่อนชำระ', 'payment goes to debt category');
  const once = dl.items.find(x => x.kind === 'once');
  r = await call('POST', `/api/debts/${once.id}/pay`, { amount: 8000 });
  ok(r.body.debt.status === 'closed' && r.body.debt.paidPct === 100, 'one-time debt closes when fully paid');
  ok((await call('POST', `/api/debts/${once.id}/pay`, {})).status === 400, 'cannot pay a closed debt');
  ok((await call('PUT', `/api/debts/${debtId}`, { installment: 6000 })).body.installment === 6000, 'edit debt');
  line.outbox = []; await lineEvent(famId, [evText('Umom', 'หนี้')]); ok(/ผ่อนรถ/.test(lastReply()), 'LINE "หนี้" lists debts');
  ok(ICS.googleUrl({ id: 'x', name: 'ผ่อนรถ', kind: 'monthly', dueDate: due(5), dueDay: 15, installmentsLeft: 3, remaining: 9000, installment: 3000 }).includes('recur=RRULE'), 'Google Calendar link with recurrence');

  const tiny = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  r = await call('PUT', `/api/members/${kid.id}`, { avatar: tiny });
  ok(r.body.avatar === tiny, 'member photo (data URL) saved');
  ok((await call('PUT', `/api/members/${kid.id}`, { avatar: 'data:text/html;base64,PHNjcmlwdD4=' })).body.avatar === tiny, 'non-image data URL rejected (keeps previous)');
  ok(!(await call('GET', '/api/transactions?limit=5')).body.some(t => (t.memberAvatar || '').startsWith('data:')), 'transaction list does not repeat photo data');
  const kc = (await call('POST', '/api/categories', { type: 'expense', name: 'ค่าขนมลูก', icon: '🍭', budget: 500 })).body;
  await call('POST', '/api/transactions', { type: 'expense', amount: 200, memberId: kid.id, categoryId: kc.id, note: 'ขนม' });
  const bud = (await call('GET', '/api/summary')).body.budgets.find(b => b.id === kc.id);
  ok(bud && bud.budget === 500 && bud.spent === 200, 'category budget: spent vs budget in summary');
  ok((await call('GET', '/api/summary')).body.incomeCategories.length > 0, 'summary has income breakdown for donut');
  process.env.OCR_MOCK = '1'; line.outbox = [];
  await lineEvent(famId, [{ type: 'message', replyToken: 'rt', source: { userId: 'Umom' }, message: { type: 'image', id: '7' } }]);
  const stx = (await call('GET', '/api/transactions?limit=1')).body[0];
  ok(stx.source === 'slip' && stx.slip && stx.slip.receiver && stx.slip.bank && !JSON.stringify(stx).includes('base64'), 'scanned slip keeps extracted data only (no image stored)');
  ok((await call('GET', '/api/backup')).body.debts.length === 2, 'backup includes debts');

  console.log('Backup / restore');
  const bk = (await call('GET', '/api/backup')).body;
  ok(bk.transactions.length > 3 && !JSON.stringify(bk).includes('Umom'), 'backup excludes LINE ids');
  ok((await call('POST', '/api/restore', bk)).status === 200, 'restore');
  ok((await call('GET', '/api/me')).body.members.find(m => m.id === mom.id).linked, 'LINE link survives restore');

  console.log(`\n${pass} checks passed`);
  server.close(); process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
