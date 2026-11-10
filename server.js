'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, save, uid, replaceAll } = require('./lib/store');
const U = require('./lib/util');
const core = require('./lib/core');
const realtime = require('./lib/realtime');
const lineLogin = require('./lib/lineLogin');
const line = require('./lib/line');
const { scanSlip } = require('./lib/slip');
const ICS = require('./public/ics.js');
const { HttpError } = U;

const PORT = +process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// ---------- helpers ----------
function readBody(req, limit = 14 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new HttpError(413, 'ข้อมูลใหญ่เกินไป')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const json = (res, status, obj) => { const s = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(s); };

const attempts = new Map(); // naive login throttle: ip -> [count, resetAt]
function throttle(ip) {
  const now = Date.now(); const e = attempts.get(ip);
  if (!e || e[1] < now) { attempts.set(ip, [1, now + 10 * 60e3]); return; }
  if (++e[0] > 20) throw new HttpError(429, 'ลองใหม่อีกครั้งในภายหลัง');
}

function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const uidv = db().sessions[token];
  const user = uidv && db().users.find(u => u.id === uidv);
  if (!user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  return user;
}
function famOf(user) {
  const f = user.familyId && db().families.find(x => x.id === user.familyId);
  if (!f) throw new HttpError(409, 'ยังไม่ได้ตั้งค่าครอบครัว');
  return f;
}
const publicBase = (req) => (process.env.PUBLIC_URL || `${(req.headers['x-forwarded-proto'] || 'http')}://${req.headers.host}`).replace(/\/$/, '');
const famIdOfReq = (req) => { try { return famOf(auth(req)).id; } catch { return null; } };
const publicFamily = (f, req) => {
  const base = publicBase(req);
  return {
    id: f.id, name: f.name, currency: f.currency, notify: f.notify,
    line: { configured: !!(line.lineCfg(f).secret && line.lineCfg(f).token), hasSecret: !!f.line?.channelSecret, hasToken: !!f.line?.accessToken, basicId: f.line?.basicId || '', webhookUrl: `${base}/webhook/line/${f.id}`, ocr: !!(process.env.ANTHROPIC_API_KEY || process.env.OCR_MOCK) },
  };
};
const publicMember = (m) => ({ id: m.id, name: m.name, role: m.role, avatar: m.avatar, color: m.color, budget: m.budget, linked: !!m.lineUserId });

// ---------- API router ----------
async function api(req, res, url) {
  const m = req.method, p = url.pathname, q = url.searchParams;
  const body = ['POST', 'PUT', 'PATCH'].includes(m) ? JSON.parse((await readBody(req)).toString() || '{}') : {};
  const ip = req.socket.remoteAddress;

  // --- public ---
  if (m === 'POST' && p === '/api/register') {
    throttle(ip);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'อีเมลไม่ถูกต้อง');
    if (String(body.password || '').length < 6) throw new HttpError(400, 'รหัสผ่านอย่างน้อย 6 ตัวอักษร');
    if (db().users.some(u => u.email === email)) throw new HttpError(409, 'อีเมลนี้ถูกใช้แล้ว');
    const { salt, hash } = U.hashPassword(body.password);
    const user = { id: uid('u_'), email, name: String(body.name || email.split('@')[0]).slice(0, 40), salt, hash, familyId: null };
    db().users.push(user);
    const token = U.newToken(); db().sessions[token] = user.id; save();
    return json(res, 201, { token });
  }
  if (m === 'POST' && p === '/api/login') {
    throttle(ip);
    const email = String(body.email || '').trim().toLowerCase();
    const user = db().users.find(u => u.email === email);
    if (!user || !user.salt || !U.verifyPassword(String(body.password || ''), user.salt, user.hash)) throw new HttpError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    const token = U.newToken(); db().sessions[token] = user.id; save();
    return json(res, 200, { token });
  }

  if (m === 'GET' && p === '/api/config') return json(res, 200, { lineLogin: lineLogin.enabled() });
  if (m === 'POST' && p === '/api/login/line') {
    throttle(ip);
    const lineId = lineLogin.takeCode(String(body.code || ''));
    if (!lineId) throw new HttpError(401, 'ลิงก์เข้าสู่ระบบหมดอายุ ลองใหม่อีกครั้ง');
    const mem = db().members.find(x => x.lineUserId === lineId);
    const fam = mem && db().families.find(x => x.id === mem.familyId);
    if (!fam) throw new HttpError(403, 'บัญชี LINE นี้ยังไม่ได้ผูกกับสมาชิก — ให้เจ้าของครอบครัวสร้างรหัส/QR แล้วผูกบัญชีก่อน');
    let u = db().users.find(x => x.lineUserId === lineId && x.familyId === fam.id);
    if (!u) { u = { id: uid('u_'), email: 'line:' + lineId, name: mem.name, familyId: fam.id, lineUserId: lineId }; db().users.push(u); }
    const token = U.newToken(); db().sessions[token] = u.id; save();
    return json(res, 200, { token });
  }

  // live updates (EventSource can't send headers → token in query)
  if (m === 'GET' && p === '/api/events') {
    if (q.get('token')) req.headers.authorization = 'Bearer ' + q.get('token');
    const eu = auth(req); const ef = famOf(eu);
    return realtime.subscribe(ef.id, res);
  }

  // --- authenticated ---
  const user = auth(req);

  if (m === 'POST' && p === '/api/logout') { delete db().sessions[(req.headers.authorization || '').slice(7)]; save(); return json(res, 200, { ok: true }); }
  if (m === 'GET' && p === '/api/me') {
    const f = user.familyId && db().families.find(x => x.id === user.familyId);
    return json(res, 200, { user: { id: user.id, name: user.name, email: user.email }, family: f ? publicFamily(f, req) : null, members: f ? db().members.filter(x => x.familyId === f.id).map(publicMember) : [] });
  }
  if (m === 'POST' && p === '/api/family') {
    if (user.familyId) throw new HttpError(409, 'มีครอบครัวอยู่แล้ว');
    const f = core.createFamily(user, String(body.name || '').slice(0, 40), body.currency || '฿', (body.members || []).filter(x => x && x.name));
    return json(res, 201, publicFamily(f, req));
  }

  const f = famOf(user);

  if (m === 'PUT' && p === '/api/family') {
    if (body.name !== undefined) f.name = String(body.name).slice(0, 40) || f.name;
    if (body.currency !== undefined) f.currency = String(body.currency).slice(0, 4) || '฿';
    if (body.notify) f.notify = { ...f.notify, ...Object.fromEntries(['onAdd', 'budget', 'daily'].filter(k => k in body.notify).map(k => [k, !!body.notify[k]])) };
    if (body.line) {
      f.line = f.line || {};
      if (typeof body.line.channelSecret === 'string' && body.line.channelSecret.trim()) f.line.channelSecret = body.line.channelSecret.trim();
      if (typeof body.line.accessToken === 'string' && body.line.accessToken.trim()) f.line.accessToken = body.line.accessToken.trim();
      if (typeof body.line.basicId === 'string') {
        const id = body.line.basicId.trim().replace(/^@/, '');
        if (id && !/^[A-Za-z0-9._-]{1,40}$/.test(id)) throw new HttpError(400, 'LINE ID ไม่ถูกต้อง');
        f.line.basicId = id;
      }
      // token just saved and no ID yet → look the OA's basic ID up so the QR works without manual input
      if (body.line.accessToken && !f.line.basicId) {
        const info = await line.fetchBotInfo(f);
        if (info?.basicId) f.line.basicId = String(info.basicId).replace(/^@/, '');
      }
    }
    save(); return json(res, 200, publicFamily(f, req));
  }

  // members
  if (m === 'GET' && p === '/api/members') return json(res, 200, db().members.filter(x => x.familyId === f.id).map(publicMember));
  if (m === 'POST' && p === '/api/members') return json(res, 201, publicMember(core.addMember(f.id, body)));
  let mm;
  if ((mm = p.match(/^\/api\/members\/([\w]+)$/))) {
    const mem = db().members.find(x => x.id === mm[1] && x.familyId === f.id);
    if (!mem) throw new HttpError(404, 'ไม่พบสมาชิก');
    if (m === 'PUT') {
      if (body.name !== undefined) mem.name = String(body.name).trim().slice(0, 30) || mem.name;
      if (body.avatar !== undefined) mem.avatar = core.cleanAvatar(body.avatar, mem.avatar);
      if (body.color !== undefined && /^#[0-9a-f]{6}$/i.test(body.color)) mem.color = body.color;
      if (body.budget !== undefined) { const b = Number(body.budget); if (!(b >= 0) || b > 1e9) throw new HttpError(400, 'งบไม่ถูกต้อง'); mem.budget = b; mem.alertState = null; }
      if (body.unlinkLine) mem.lineUserId = null;
      save(); return json(res, 200, publicMember(mem));
    }
    if (m === 'DELETE') {
      const has = core.famTx(f.id).some(t => t.memberId === mem.id);
      if (has && q.get('force') !== '1') throw new HttpError(409, 'สมาชิกนี้มีรายการบันทึกอยู่ (ลบพร้อมรายการทั้งหมดหรือไม่?)');
      db().transactions = db().transactions.filter(t => t.memberId !== mem.id);
      db().members = db().members.filter(x => x.id !== mem.id); save();
      return json(res, 200, { ok: true });
    }
  }
  if ((mm = p.match(/^\/api\/members\/([\w]+)\/linkcode$/)) && m === 'POST') {
    const mem = db().members.find(x => x.id === mm[1] && x.familyId === f.id);
    if (!mem) throw new HttpError(404, 'ไม่พบสมาชิก');
    mem.linkCode = String(crypto.randomInt(100000, 999999)); mem.linkExpires = Date.now() + 60 * 60e3; save();
    const basicId = f.line?.basicId || '';
    return json(res, 200, { code: mem.linkCode, expiresInMinutes: 60, basicId,
      url: basicId ? `https://line.me/R/oaMessage/%40${encodeURIComponent(basicId)}/?${encodeURIComponent('ผูก ' + mem.linkCode)}` : '',
      addUrl: basicId ? `https://line.me/R/ti/p/%40${encodeURIComponent(basicId)}` : '' });
  }
  if ((mm = p.match(/^\/api\/members\/([\w]+)\/stats$/)) && m === 'GET') return json(res, 200, core.memberStats(f.id, mm[1], q.get('range') || 'month', q.get('from'), q.get('to')));

  // categories
  if (m === 'GET' && p === '/api/categories') return json(res, 200, db().categories.filter(c => c.familyId === f.id).sort((a, b) => (a.order || 0) - (b.order || 0)));
  if (m === 'POST' && p === '/api/categories') {
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) throw new HttpError(400, 'กรุณาใส่ชื่อหมวดหมู่');
    let parent = null;
    if (body.parentId) { parent = core.catById(body.parentId); if (!parent || parent.familyId !== f.id || parent.parentId) throw new HttpError(400, 'หมวดหลักไม่ถูกต้อง'); }
    const type = parent ? parent.type : (body.type === 'income' ? 'income' : 'expense');
    const siblings = db().categories.filter(c => c.familyId === f.id && c.type === type && (c.parentId || null) === (parent?.id || null));
    const c = { id: uid('c_'), familyId: f.id, type, name, icon: parent ? parent.icon : (body.icon || '📁'), color: parent ? parent.color : (/^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#3d8bff'), parentId: parent?.id || null, order: siblings.length, budget: parent ? 0 : Math.max(0, Number(body.budget) || 0) };
    db().categories.push(c); save(); return json(res, 201, c);
  }
  if ((mm = p.match(/^\/api\/categories\/([\w]+)$/))) {
    const c = core.catById(mm[1]);
    if (!c || c.familyId !== f.id) throw new HttpError(404, 'ไม่พบหมวดหมู่');
    if (m === 'PUT') {
      if (body.name !== undefined) c.name = String(body.name).trim().slice(0, 40) || c.name;
      if (!c.parentId) {
        if (body.budget !== undefined) c.budget = Math.max(0, Number(body.budget) || 0);
        if (body.icon !== undefined) c.icon = String(body.icon).slice(0, 8);
        if (body.color !== undefined && /^#[0-9a-f]{6}$/i.test(body.color)) { c.color = body.color; db().categories.filter(x => x.parentId === c.id).forEach(x => x.color = body.color); }
      }
      save(); return json(res, 200, c);
    }
    if (m === 'DELETE') {
      const ids = new Set([c.id, ...db().categories.filter(x => x.parentId === c.id).map(x => x.id)]);
      const used = db().transactions.filter(t => ids.has(t.categoryId)).length;
      if (used && q.get('force') !== '1') throw new HttpError(409, `หมวดนี้ถูกใช้ใน ${used} รายการ (ลบรายการเหล่านั้นด้วยหรือไม่?)`);
      db().transactions = db().transactions.filter(t => !ids.has(t.categoryId));
      db().categories = db().categories.filter(x => !ids.has(x.id)); save();
      return json(res, 200, { ok: true });
    }
  }

  // transactions
  if (m === 'GET' && p === '/api/transactions') {
    let tx = core.famTx(f.id).filter(t => core.inRange(t, q.get('from'), q.get('to')));
    if (q.get('member')) tx = tx.filter(t => t.memberId === q.get('member'));
    if (q.get('type')) tx = tx.filter(t => t.type === q.get('type'));
    tx.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    return json(res, 200, tx.slice(0, Math.min(+q.get('limit') || 100, 1000)).map(core.enrich));
  }
  if (m === 'POST' && p === '/api/transactions') {
    if (body.slipRef && core.famTx(f.id).some(t => t.slipRef === body.slipRef)) throw new HttpError(409, 'สลิปนี้เคยบันทึกแล้ว');
    const tx = core.createTransaction(f.id, body, { source: body.slipRef ? 'slip' : 'app', ...(body.slipRef ? { slipRef: String(body.slipRef) } : {}), ...(core.sanitizeSlip(body.slip) ? { slip: core.sanitizeSlip(body.slip) } : {}) });
    const actor = db().members.find(x => x.id === tx.memberId);
    line.afterExpense(f, tx, actor, false).catch(() => {}); // LINE push to other members + budget alerts
    return json(res, 201, core.enrich(tx));
  }
  if ((mm = p.match(/^\/api\/transactions\/([\w]+)$/))) {
    const tx = db().transactions.find(t => t.id === mm[1] && t.familyId === f.id);
    if (!tx) throw new HttpError(404, 'ไม่พบรายการ');
    if (m === 'PUT') {
      const v = core.validateTxInput(f.id, { ...tx, ...body }, false);
      if (core.catById(v.categoryId).type !== v.type) throw new HttpError(400, 'หมวดหมู่ไม่ตรงกับประเภท');
      Object.assign(tx, v); save(); return json(res, 200, core.enrich(tx));
    }
    if (m === 'DELETE') { db().transactions = db().transactions.filter(t => t.id !== tx.id); save(); return json(res, 200, { ok: true }); }
  }

  // debts (+ calendar feed)
  if (m === 'GET' && p === '/api/debts') {
    f.calToken ||= crypto.randomBytes(16).toString('hex'); save();
    const base = process.env.PUBLIC_URL || `${(req.headers['x-forwarded-proto'] || 'http')}://${req.headers.host}`;
    return json(res, 200, { ...core.listDebts(f.id), feed: `${base}/calendar/${f.calToken}.ics` });
  }
  if (m === 'POST' && p === '/api/debts') return json(res, 201, core.decorateDebt(core.createDebt(f.id, body)));
  if ((mm = p.match(/^\/api\/debts\/(\w+)\/pay$/)) && m === 'POST') {
    const r = core.payDebt(f.id, mm[1], body);
    const actor = db().members.find(x => x.id === r.transaction.memberId);
    if (actor) line.afterExpense(f, r.transaction, actor, false).catch(() => {});
    return json(res, 200, r);
  }
  if ((mm = p.match(/^\/api\/debts\/(\w+)$/))) {
    if (m === 'PUT') return json(res, 200, core.decorateDebt(core.updateDebt(f.id, mm[1], body)));
    if (m === 'DELETE') { core.deleteDebt(f.id, mm[1]); return json(res, 200, { ok: true }); }
  }

  // dashboards & reports
  if (m === 'GET' && p === '/api/summary') return json(res, 200, core.summary(f.id, /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : undefined));
  if (m === 'GET' && p === '/api/report') return json(res, 200, core.report(f.id, q.get('range') || 'month', q.get('from'), q.get('to'), q.get('member') || null));

  // slip scan (web)
  if (m === 'POST' && p === '/api/slip/scan') {
    const mt = String(body.mime || '').toLowerCase();
    const buf = Buffer.from(String(body.image || '').replace(/^data:[^,]+,/, ''), 'base64');
    if (!buf.length) throw new HttpError(400, 'ไม่พบรูป');
    const names = (type) => db().categories.filter(c => c.familyId === f.id && c.type === type && !c.parentId).map(c => c.name);
    const r = await scanSlip(buf, mt, { expense: names('expense'), income: names('income') });
    const cat = core.guessCategory(f.id, r.type, [r.category, r.receiver, r.memo].filter(Boolean).join(' '));
    const dup = !!(r.ref && core.famTx(f.id).some(t => t.slipRef === r.ref));
    return json(res, 200, { ...r, categoryId: cat?.id, duplicate: dup, note: [r.receiver, r.memo].filter(Boolean).join(' · ').slice(0, 120) });
  }

  // LINE helpers
  if (m === 'POST' && p === '/api/line/test') {
    const targets = db().members.filter(x => x.familyId === f.id && x.lineUserId);
    if (!targets.length) throw new HttpError(400, 'ยังไม่มีสมาชิกที่ผูก LINE');
    if (!line.lineCfg(f).token) throw new HttpError(400, 'ยังไม่ได้ตั้งค่า Channel access token');
    await line.notifyFamily(f, '✅ ทดสอบแจ้งเตือนจาก Family Budget สำเร็จ');
    return json(res, 200, { sent: targets.length });
  }

  // backup / restore (this family only)
  if (m === 'GET' && p === '/api/backup') {
    const d = db();
    const data = { version: 1, exportedAt: new Date().toISOString(), family: { name: f.name, currency: f.currency, notify: f.notify }, members: d.members.filter(x => x.familyId === f.id).map(({ lineUserId, linkCode, linkExpires, alertState, ...r }) => r), categories: d.categories.filter(x => x.familyId === f.id), transactions: d.transactions.filter(x => x.familyId === f.id), debts: d.debts.filter(x => x.familyId === f.id) };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="family-budget-${U.todayBkk()}.json"` });
    return res.end(JSON.stringify(data, null, 1));
  }
  if (m === 'POST' && p === '/api/restore') {
    if (body.version !== 1 || !Array.isArray(body.members) || !Array.isArray(body.categories) || !Array.isArray(body.transactions)) throw new HttpError(400, 'ไฟล์สำรองไม่ถูกต้อง');
    const d = db();
    const keepLine = new Map(d.members.filter(x => x.familyId === f.id).map(x => [x.id, x]));
    d.members = d.members.filter(x => x.familyId !== f.id); d.categories = d.categories.filter(x => x.familyId !== f.id); d.transactions = d.transactions.filter(x => x.familyId !== f.id);
    for (const x of body.members) d.members.push({ ...x, familyId: f.id, lineUserId: keepLine.get(x.id)?.lineUserId || null, linkCode: null, linkExpires: 0 });
    for (const x of body.categories) d.categories.push({ ...x, familyId: f.id });
    for (const x of body.transactions) d.transactions.push({ ...x, familyId: f.id });
    d.debts = d.debts.filter(x => x.familyId !== f.id); for (const x of (body.debts || [])) d.debts.push({ ...x, familyId: f.id });
    if (body.family?.name) f.name = String(body.family.name).slice(0, 40);
    save(); return json(res, 200, { ok: true, transactions: body.transactions.length });
  }

  throw new HttpError(404, 'ไม่พบ API');
}

// ---------- LINE webhook ----------
async function webhook(req, res, url) {
  const m = url.pathname.match(/^\/webhook\/line\/([\w]+)$/);
  const f = m && db().families.find(x => x.id === m[1]);
  if (!f) return json(res, 404, { error: 'unknown family' });
  const raw = await readBody(req, 2 * 1024 * 1024);
  if (!line.verifySignature(line.lineCfg(f).secret, raw, req.headers['x-line-signature'])) return json(res, 401, { error: 'bad signature' });
  json(res, 200, { ok: true }); // ack fast; LINE requires 200 quickly
  let events = [];
  try { events = JSON.parse(raw.toString()).events || []; } catch (_) { return; }
  for (const ev of events) { try { await line.handleEvent(f, ev); } catch (e) { console.error('[line] event error', e); } }
  if (events.length) realtime.broadcast(f.id);
}

// ---------- static ----------
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (rel === '/sw.js') { // version = hash of the app files, so a deploy changes sw.js → browsers update themselves
    const ver = crypto.createHash('sha1');
    for (const n of fs.readdirSync(PUBLIC).sort()) { const st = fs.statSync(path.join(PUBLIC, n)); ver.update(n + st.size + st.mtimeMs); }
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    return res.end(fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8').replaceAll('__VERSION__', ver.digest('hex').slice(0, 12)));
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/webhook/line/') && req.method === 'POST') return await webhook(req, res, url);
    if (url.pathname === '/auth/line/start' && req.method === 'GET') {
      if (!lineLogin.enabled()) { res.writeHead(302, { Location: '/?lerr=off' }); return res.end(); }
      res.writeHead(302, { Location: lineLogin.startUrl(publicBase(req) + '/auth/line/callback') }); return res.end();
    }
    if (url.pathname === '/auth/line/callback' && req.method === 'GET') {
      const back = (qs) => { res.writeHead(302, { Location: '/?' + qs }); res.end(); };
      if (!lineLogin.checkState(url.searchParams.get('state') || '')) return back('lerr=state');
      if (url.searchParams.get('error') || !url.searchParams.get('code')) return back('lerr=cancel');
      try { return back('lc=' + lineLogin.issueCode(await lineLogin.lineUserId(url.searchParams.get('code'), publicBase(req) + '/auth/line/callback'))); }
      catch (e) { console.warn('[line-login]', e.message); return back('lerr=fail'); }
    }
    if (url.pathname.startsWith('/api/')) {
      const mut = req.method !== 'GET' && url.pathname !== '/api/events';
      const fid = mut ? famIdOfReq(req) : null;
      const r = await api(req, res, url);
      if (fid && res.statusCode < 400) realtime.broadcast(fid);
      return r;
    }
    let cm;
    if ((cm = url.pathname.match(/^\/calendar\/([a-f0-9]{32})\.ics$/)) && req.method === 'GET') {
      const fam = db().families.find(x => x.calToken === cm[1]);
      if (!fam) return json(res, 404, { error: 'not found' });
      const body = ICS.calendar(db().debts.filter(x => x.familyId === fam.id), { cur: fam.currency, name: `หนี้สิน · ${fam.name}` });
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(body);
    }
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    return serveStatic(req, res, url);
  } catch (e) {
    if (res.headersSent) return;
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    if (e instanceof SyntaxError) return json(res, 400, { error: 'ข้อมูลไม่ถูกต้อง' });
    console.error(e); return json(res, 500, { error: 'เกิดข้อผิดพลาดในระบบ' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Family Budget running → http://localhost:${PORT}`));
  line.startScheduler();
}
module.exports = server;
