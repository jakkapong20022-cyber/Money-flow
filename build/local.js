// Browser-side API: same endpoints as server.js, backed by localStorage. Scope provides: core, U (util), store, parseSlipText.
(function () {
  const { HttpError } = U;
  const d = () => store.db();
  const user = () => { let u = d().users[0]; if (!u) { u = { id: 'u_local', name: 'ฉัน', email: 'บันทึกในเครื่องนี้', familyId: null }; d().users.push(u); store.save(); } return u; };
  const fam = () => { const f = d().families.find(x => x.id === user().familyId); if (!f) throw new HttpError(409, 'ยังไม่ได้ตั้งค่าครอบครัว'); return f; };
  const pubF = (f) => ({ id: f.id, name: f.name, currency: f.currency, notify: f.notify, line: { configured: false, hasSecret: false, hasToken: false, webhookUrl: '', ocr: true } });
  const pubM = (m) => ({ id: m.id, name: m.name, role: m.role, avatar: m.avatar, color: m.color, budget: m.budget, linked: false });
  const HEX = /^#[0-9a-f]{6}$/i;
  let tesseractP = null;
  function loadTesseract() {
    return tesseractP ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'; s.onload = () => res(window.Tesseract); s.onerror = () => rej(new HttpError(502, 'โหลดตัวอ่านสลิปไม่ได้ (ต้องต่ออินเทอร์เน็ตครั้งแรก)')); document.head.appendChild(s); });
  }
  async function scan(body, f) {
    const T = await loadTesseract();
    const r = await T.recognize(body.image, 'tha+eng');
    const text = r.data.text || '';
    const p = parseSlipText(text);
    const cat = core.guessCategory(f.id, p.type, [p.receiver, text.slice(0, 400)].filter(Boolean).join(' '));
    const dup = !!(p.ref && core.famTx(f.id).some(t => t.slipRef === p.ref));
    return { ...p, categoryId: cat?.id, duplicate: dup, note: [p.receiver, p.memo].filter(Boolean).join(' · ').slice(0, 120) };
  }

  async function handle(method, path, body = {}) {
    const url = new URL(path, 'http://x'), p = url.pathname, q = url.searchParams, m = method;
    if (p === '/me') { const u = user(); const f = d().families.find(x => x.id === u.familyId); return { user: { id: u.id, name: u.name, email: u.email }, family: f ? pubF(f) : null, members: f ? d().members.filter(x => x.familyId === f.id).map(pubM) : [] }; }
    if (m === 'POST' && p === '/family') { const u = user(); if (u.familyId) throw new HttpError(409, 'มีครอบครัวอยู่แล้ว'); return pubF(core.createFamily(u, String(body.name || '').slice(0, 40), body.currency || '฿', (body.members || []).filter(x => x && x.name))); }
    const f = fam(); let mm;
    if (m === 'PUT' && p === '/family') {
      if (body.name !== undefined) f.name = String(body.name).slice(0, 40) || f.name;
      if (body.currency !== undefined) f.currency = String(body.currency).slice(0, 4) || '฿';
      if (body.notify) f.notify = { ...f.notify, ...body.notify };
      store.save(); return pubF(f);
    }
    if (m === 'POST' && p === '/members') return pubM(core.addMember(f.id, body));
    if ((mm = p.match(/^\/members\/(\w+)\/stats$/))) return core.memberStats(f.id, mm[1], q.get('range') || 'month', q.get('from'), q.get('to'));
    if ((mm = p.match(/^\/members\/(\w+)$/))) {
      const mem = d().members.find(x => x.id === mm[1] && x.familyId === f.id); if (!mem) throw new HttpError(404, 'ไม่พบสมาชิก');
      if (m === 'PUT') {
        if (body.name !== undefined) mem.name = String(body.name).trim().slice(0, 30) || mem.name;
        if (body.avatar !== undefined) mem.avatar = core.cleanAvatar(body.avatar, mem.avatar);
        if (HEX.test(body.color || '')) mem.color = body.color;
        if (body.budget !== undefined) { const b = Number(body.budget); if (!(b >= 0) || b > 1e9) throw new HttpError(400, 'งบไม่ถูกต้อง'); mem.budget = b; }
        store.save(); return pubM(mem);
      }
      if (m === 'DELETE') {
        if (core.famTx(f.id).some(t => t.memberId === mem.id) && q.get('force') !== '1') throw new HttpError(409, 'สมาชิกนี้มีรายการบันทึกอยู่ (ลบพร้อมรายการทั้งหมดหรือไม่?)');
        d().transactions = d().transactions.filter(t => t.memberId !== mem.id); d().members = d().members.filter(x => x.id !== mem.id); store.save(); return { ok: true };
      }
    }
    if (m === 'GET' && p === '/categories') return d().categories.filter(c => c.familyId === f.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (m === 'POST' && p === '/categories') {
      const name = String(body.name || '').trim().slice(0, 40); if (!name) throw new HttpError(400, 'กรุณาใส่ชื่อหมวดหมู่');
      let parent = null; if (body.parentId) { parent = core.catById(body.parentId); if (!parent || parent.familyId !== f.id || parent.parentId) throw new HttpError(400, 'หมวดหลักไม่ถูกต้อง'); }
      const type = parent ? parent.type : (body.type === 'income' ? 'income' : 'expense');
      const n = d().categories.filter(c => c.familyId === f.id && c.type === type && (c.parentId || null) === (parent?.id || null)).length;
      const c = { id: store.uid('c_'), familyId: f.id, type, name, icon: parent ? parent.icon : (body.icon || '📁'), color: parent ? parent.color : (HEX.test(body.color || '') ? body.color : '#3d8bff'), parentId: parent?.id || null, order: n, budget: parent ? 0 : Math.max(0, Number(body.budget) || 0) };
      d().categories.push(c); store.save(); return c;
    }
    if ((mm = p.match(/^\/categories\/(\w+)$/))) {
      const c = core.catById(mm[1]); if (!c || c.familyId !== f.id) throw new HttpError(404, 'ไม่พบหมวดหมู่');
      if (m === 'PUT') {
        if (body.name !== undefined) c.name = String(body.name).trim().slice(0, 40) || c.name;
        if (!c.parentId) { if (body.budget !== undefined) c.budget = Math.max(0, Number(body.budget) || 0); if (body.icon !== undefined) c.icon = String(body.icon).slice(0, 8); if (HEX.test(body.color || '')) { c.color = body.color; d().categories.filter(x => x.parentId === c.id).forEach(x => x.color = body.color); } }
        store.save(); return c;
      }
      if (m === 'DELETE') {
        const ids = new Set([c.id, ...d().categories.filter(x => x.parentId === c.id).map(x => x.id)]);
        const used = d().transactions.filter(t => ids.has(t.categoryId)).length;
        if (used && q.get('force') !== '1') throw new HttpError(409, `หมวดนี้ถูกใช้ใน ${used} รายการ (ลบรายการเหล่านั้นด้วยหรือไม่?)`);
        d().transactions = d().transactions.filter(t => !ids.has(t.categoryId)); d().categories = d().categories.filter(x => !ids.has(x.id)); store.save(); return { ok: true };
      }
    }
    if (m === 'GET' && p === '/transactions') {
      let tx = core.famTx(f.id).filter(t => core.inRange(t, q.get('from'), q.get('to')));
      if (q.get('member')) tx = tx.filter(t => t.memberId === q.get('member')); if (q.get('type')) tx = tx.filter(t => t.type === q.get('type'));
      return tx.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, Math.min(+q.get('limit') || 100, 1000)).map(core.enrich);
    }
    if (m === 'POST' && p === '/transactions') {
      if (body.slipRef && core.famTx(f.id).some(t => t.slipRef === body.slipRef)) throw new HttpError(409, 'สลิปนี้เคยบันทึกแล้ว');
      return core.enrich(core.createTransaction(f.id, body, { source: body.slipRef ? 'slip' : 'app', ...(body.slipRef ? { slipRef: String(body.slipRef) } : {}), ...(core.sanitizeSlip(body.slip) ? { slip: core.sanitizeSlip(body.slip) } : {}) }));
    }
    if ((mm = p.match(/^\/transactions\/(\w+)$/))) {
      const tx = d().transactions.find(t => t.id === mm[1] && t.familyId === f.id); if (!tx) throw new HttpError(404, 'ไม่พบรายการ');
      if (m === 'PUT') { const v = core.validateTxInput(f.id, { ...tx, ...body }, false); if (core.catById(v.categoryId).type !== v.type) throw new HttpError(400, 'หมวดหมู่ไม่ตรงกับประเภท'); Object.assign(tx, v); store.save(); return core.enrich(tx); }
      if (m === 'DELETE') { d().transactions = d().transactions.filter(t => t.id !== tx.id); store.save(); return { ok: true }; }
    }
    if (m === 'GET' && p === '/debts') return { ...core.listDebts(f.id), feed: '' };
    if (m === 'POST' && p === '/debts') return core.decorateDebt(core.createDebt(f.id, body));
    if ((mm = p.match(/^\/debts\/(\w+)\/pay$/)) && m === 'POST') return core.payDebt(f.id, mm[1], body);
    if ((mm = p.match(/^\/debts\/(\w+)$/))) {
      if (m === 'PUT') return core.decorateDebt(core.updateDebt(f.id, mm[1], body));
      if (m === 'DELETE') { core.deleteDebt(f.id, mm[1]); return { ok: true }; }
    }
    if (m === 'GET' && p === '/summary') return core.summary(f.id, /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : undefined);
    if (m === 'GET' && p === '/report') return core.report(f.id, q.get('range') || 'month', q.get('from'), q.get('to'), q.get('member') || null);
    if (m === 'POST' && p === '/slip/scan') return scan(body, f);
    if (m === 'GET' && p === '/backup') {
      return { version: 1, exportedAt: new Date().toISOString(), family: { name: f.name, currency: f.currency, notify: f.notify }, members: d().members.filter(x => x.familyId === f.id).map(({ lineUserId, linkCode, linkExpires, alertState, ...r }) => r), categories: d().categories.filter(x => x.familyId === f.id), transactions: d().transactions.filter(x => x.familyId === f.id), debts: d().debts.filter(x => x.familyId === f.id) };
    }
    if (m === 'POST' && p === '/restore') {
      if (body.version !== 1 || !Array.isArray(body.members) || !Array.isArray(body.categories) || !Array.isArray(body.transactions)) throw new HttpError(400, 'ไฟล์สำรองไม่ถูกต้อง');
      const D = d(); for (const k of ['members', 'categories', 'transactions']) D[k] = D[k].filter(x => x.familyId !== f.id);
      body.members.forEach(x => D.members.push({ ...x, familyId: f.id, lineUserId: null, linkCode: null, linkExpires: 0 })); body.categories.forEach(x => D.categories.push({ ...x, familyId: f.id })); body.transactions.forEach(x => D.transactions.push({ ...x, familyId: f.id }));
      if (body.family?.name) f.name = String(body.family.name).slice(0, 40);
      D.debts = D.debts.filter(x => x.familyId !== f.id); (body.debts || []).forEach(x => D.debts.push({ ...x, familyId: f.id }));
      store.save(); return { ok: true, transactions: body.transactions.length };
    }
    throw new HttpError(404, 'ฟังก์ชันนี้ใช้ไม่ได้ในโหมดในเครื่อง');
  }
  window.LOCAL = { handle };
})();
