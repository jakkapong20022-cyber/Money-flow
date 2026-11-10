'use strict';
// LINE Official Account integration: webhook, commands, slip images, push notifications.
const crypto = require('crypto');
const { db, save } = require('./store');
const core = require('./core');
const { scanSlip } = require('./slip');
const { fmt, todayBkk, monthKey, bkkNow, dmy } = require('./util');

const flex = require('./flex');
const API = 'https://api.line.me/v2/bot';
const av = (m) => String(m.avatar || '').startsWith('data:') ? '👤' : m.avatar; // photo avatars can't go in a text message
const lineCfg = (f) => ({
  secret: f.line?.channelSecret || process.env.LINE_CHANNEL_SECRET || '',
  token: f.line?.accessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

function verifySignature(secret, rawBody, sig) {
  if (!secret || !sig) return false;
  const h = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const b = Buffer.from(sig, 'base64');
  return h.length === b.length && crypto.timingSafeEqual(h, b);
}

async function lineFetch(token, url, body) {
  if (process.env.LINE_DRY_RUN) { (module.exports.outbox ||= []).push({ url, body }); return { ok: true, json: async () => ({}) }; }
  const res = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) console.warn('[line] API', res.status, await res.text().catch(() => ''));
  return res;
}
async function fetchBotInfo(f) {
  const { token } = lineCfg(f); if (!token) return null;
  if (process.env.LINE_DRY_RUN) return process.env.LINE_DRY_BASIC_ID ? { basicId: process.env.LINE_DRY_BASIC_ID } : null;
  try {
    const res = await fetch(API + '/info', { headers: { Authorization: 'Bearer ' + token } });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
const reply = (f, replyToken, messages) => { const { token } = lineCfg(f); return token && replyToken ? lineFetch(token, API + '/message/reply', { replyToken, messages: [].concat(messages) }) : null; };
const push = (f, to, messages) => { const { token } = lineCfg(f); return token && to ? lineFetch(token, API + '/message/push', { to, messages: [].concat(messages) }) : null; };
const text = (t, quick) => ({ type: 'text', text: t, ...(quick ? { quickReply: { items: quick.map(q => ({ type: 'action', action: { type: 'message', label: q, text: q } })) } } : {}) });

async function getContent(f, messageId) {
  if (process.env.LINE_DRY_RUN) return { buf: Buffer.from('x'), mime: 'image/jpeg' };
  const { token } = lineCfg(f);
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('content ' + res.status);
  return { buf: Buffer.from(await res.arrayBuffer()), mime: (res.headers.get('content-type') || 'image/jpeg').split(';')[0] };
}

// ---- notify all linked members (optionally excluding one) ----
async function notifyFamily(f, msg, excludeMemberId) { // msg: plain string or a ready-made LINE message object (e.g. flex)
  const targets = db().members.filter(m => m.familyId === f.id && m.lineUserId && m.id !== excludeMemberId);
  await Promise.all(targets.map(m => push(f, m.lineUserId, typeof msg === 'string' ? text(msg) : msg)));
}

async function afterExpense(f, tx, actor, actorGetsReply) {
  const d = [];
  if (f.notify?.onAdd) {
    const c = core.catById(tx.categoryId);
    await notifyFamily(f, flex.txCard(f, tx, c, actor.name), actor.id);
  }
  if (tx.type === 'expense' && f.notify?.budget) {
    const alert = core.budgetAlert(f.id, tx.memberId);
    if (alert) { await notifyFamily(f, alert, actorGetsReply ? actor.id : null); d.push(alert); }
  }
  return d; // alerts the actor should see inline when they got a reply
}

// ---- text command parsing ----
const NUM = '([\\d,]+(?:\\.\\d+)?)';
function parseCommand(t) {
  t = t.trim().replace(/\s+/g, ' ');
  let m;
  if ((m = t.match(new RegExp(`^(?:จ่าย|รายจ่าย|expense|exp|-)\\s*${NUM}\\s*(.*)$`, 'i')))) return { cmd: 'add', type: 'expense', amount: m[1], note: m[2] };
  if ((m = t.match(new RegExp(`^(?:รับ|รายรับ|income|inc|\\+)\\s*${NUM}\\s*(.*)$`, 'i')))) return { cmd: 'add', type: 'income', amount: m[1], note: m[2] };
  if ((m = t.match(new RegExp(`^(.+?)\\s+${NUM}$`)))) return { cmd: 'add', type: 'expense', amount: m[2], note: m[1] }; // "ข้าวมันไก่ 60"
  if (/^(สรุป|summary|ยอด|รายงาน)$/i.test(t)) return { cmd: 'summary' };
  if (/^(วันนี้|today)$/i.test(t)) return { cmd: 'today' };
  if (/^(หนี้|หนี้สิน|debts?)$/i.test(t)) return { cmd: 'debts' };
  if (/^(ลบล่าสุด|ยกเลิก|undo)$/i.test(t)) return { cmd: 'undo' };
  if (/^เปลี่ยนเป็นรายรับ$/.test(t)) return { cmd: 'flip', to: 'income' };
  if (/^เปลี่ยนเป็นรายจ่าย$/.test(t)) return { cmd: 'flip', to: 'expense' };
  if ((m = t.match(/^(?:ผูก|link|เชื่อม)\s*(\d{4,8})$/i))) return { cmd: 'link', code: m[1] };
  if (/^(วิธีใช้|help|ช่วยเหลือ|\?|เมนู)$/i.test(t)) return { cmd: 'help' };
  return null;
}

const HELP = `📒 วิธีใช้ Family Budget
• จ่าย 120 ข้าวมันไก่
• รับ 5000 เงินเดือน
• ข้าวมันไก่ 60 (พิมพ์สั้นๆ = รายจ่าย)
• ส่งรูปสลิป/ใบเสร็จ → บันทึกให้อัตโนมัติ
• สรุป / วันนี้ / หนี้ → ดูยอดและกำหนดชำระหนี้
• ลบล่าสุด → ยกเลิกรายการล่าสุดของคุณ
• เปลี่ยนเป็นรายรับ → สลับประเภทรายการล่าสุด`;

function summaryText(f, member) {
  const s = core.summary(f.id);
  const top = s.categories.slice(0, 3).map(c => `${c.icon} ${c.name} ${fmt(c.amount)}`).join('\n');
  const mine = s.members.find(m => m.id === member.id);
  let t = `📊 สรุปเดือน ${s.month.slice(5)}/${s.month.slice(0, 4)}\nคงเหลือรวม: ${f.currency}${fmt(s.balance)}\nรายรับ ${fmt(s.income)} | รายจ่าย ${fmt(s.expense)}`;
  if (top) t += `\n\nหมวดที่ใช้มากสุด\n${top}`;
  if (mine) t += `\n\n${av(member)} ของ ${member.name}: จ่าย ${fmt(mine.spent)}${mine.budget ? ` / งบ ${fmt(mine.budget)}` : ''}`;
  return t;
}

function lastTxOf(f, member) {
  return core.famTx(f.id).filter(t => t.memberId === member.id && t.source !== 'app-seed').sort((a, b) => b.createdAt - a.createdAt)[0];
}

async function handleText(f, ev, member) {
  const p = parseCommand(ev.message.text);
  const rt = ev.replyToken;
  if (!p) return reply(f, rt, text('ไม่เข้าใจคำสั่ง 😅\nพิมพ์ "วิธีใช้" เพื่อดูตัวอย่าง'));
  switch (p.cmd) {
    case 'help': return reply(f, rt, text(HELP));
    case 'link': return reply(f, rt, text(`บัญชีนี้ผูกกับ ${av(member)} ${member.name} อยู่แล้ว`));
    case 'summary': { const sm = core.summary(f.id); return reply(f, rt, flex.summaryCard(f, sm, sm.members.find(x => x.id === member.id) && { name: member.name, ...sm.members.find(x => x.id === member.id) }, summaryText(f, member))); }
    case 'debts': {
      const { items, summary: ds } = core.listDebts(f.id);
      const act = items.filter(x => x.status === 'active');
      if (!act.length) return reply(f, rt, text('🎉 ไม่มีหนี้ค้างชำระ'));
      const plain = `💳 หนี้สินคงเหลือ ${f.currency}${fmt(ds.totalRemaining)}\n` + act.slice(0, 8).map(x => `• ${x.name} ${f.currency}${fmt(Math.min(x.installment || x.remaining, x.remaining))} — ${x.overdue ? '⚠️ เกินกำหนด ' + (-x.daysLeft) + ' วัน' : x.daysLeft === 0 ? 'วันนี้' : 'อีก ' + x.daysLeft + ' วัน'} (${dmy(x.dueDate)})`).join('\n');
      return reply(f, rt, flex.debtListCard(f, act, ds.totalRemaining, plain));
    }
    case 'today': {
      const today = todayBkk();
      const tx = core.famTx(f.id).filter(t => t.date === today);
      const tt = core.totals(tx);
      return reply(f, rt, text(`📅 วันนี้ (${dmy(today)})\nรายรับ ${fmt(tt.income)} | รายจ่าย ${fmt(tt.expense)}\nจำนวน ${tx.length} รายการ`));
    }
    case 'undo': {
      const t = lastTxOf(f, member);
      if (!t) return reply(f, rt, text('ไม่มีรายการให้ลบ'));
      const d = db(); d.transactions = d.transactions.filter(x => x.id !== t.id); save();
      return reply(f, rt, text(`🗑 ลบแล้ว: ${fmt(t.amount)} ${core.catById(t.categoryId)?.name || ''}`));
    }
    case 'flip': {
      const t = lastTxOf(f, member);
      if (!t) return reply(f, rt, text('ไม่มีรายการล่าสุด'));
      if (t.type === p.to) return reply(f, rt, text('รายการล่าสุดเป็นประเภทนี้อยู่แล้ว'));
      const cat = core.guessCategory(f.id, p.to, t.note);
      t.type = p.to; t.categoryId = cat.id; save();
      return reply(f, rt, text(`✅ เปลี่ยนเป็น${p.to === 'income' ? 'รายรับ' : 'รายจ่าย'}แล้ว · ${cat.name}`));
    }
    case 'add': {
      const cat = core.guessCategory(f.id, p.type, p.note);
      let tx;
      try { tx = core.createTransaction(f.id, { type: p.type, amount: p.amount, memberId: member.id, categoryId: cat.id, note: p.note }, { source: 'line' }); }
      catch (e) { return reply(f, rt, text('❌ ' + e.message)); }
      const alerts = await afterExpense(f, tx, member, true);
      const msg = `✅ บันทึก${p.type === 'income' ? 'รายรับ' : 'รายจ่าย'}แล้ว\n${cat.icon} ${cat.name}\n${f.currency}${fmt(tx.amount)}${p.note ? '\n📝 ' + p.note : ''}${alerts.length ? '\n\n' + alerts.join('\n') : ''}`;
      return reply(f, rt, text(msg, ['ลบล่าสุด', p.type === 'expense' ? 'เปลี่ยนเป็นรายรับ' : 'เปลี่ยนเป็นรายจ่าย', 'สรุป']));
    }
  }
}

async function handleImage(f, ev, member) {
  const rt = ev.replyToken;
  let result;
  try {
    const { buf, mime } = await getContent(f, ev.message.id);
    const d = db();
    const names = (type) => d.categories.filter(c => c.familyId === f.id && c.type === type && !c.parentId).map(c => c.name);
    result = await scanSlip(buf, mime, { expense: names('expense'), income: names('income') });
  } catch (e) {
    console.warn('[slip]', e.message);
    return reply(f, rt, text(e.status === 501 ? '⚠️ ระบบสแกนสลิปยังไม่ได้เปิดใช้งาน (ผู้ดูแลต้องตั้งค่า ANTHROPIC_API_KEY)\nพิมพ์เช่น "จ่าย 120 ข้าว" แทนได้เลย' : '❌ อ่านรูปไม่สำเร็จ ลองถ่ายให้ชัดขึ้น หรือพิมพ์เช่น "จ่าย 120 ข้าว"'));
  }
  if (!result.isSlip || !result.amount) return reply(f, rt, text('🤔 ไม่พบยอดเงินในรูปนี้ ลองส่งรูปสลิปให้ชัดขึ้น หรือพิมพ์ "จ่าย 120 ข้าว"'));
  if (result.ref && core.famTx(f.id).some(t => t.slipRef === result.ref)) return reply(f, rt, text(`⚠️ สลิปนี้เคยบันทึกแล้ว (Ref ${result.ref})`));
  const type = result.type;
  const hint = [result.category, result.receiver, result.memo].filter(Boolean).join(' ');
  const cat = core.guessCategory(f.id, type, hint);
  const note = [result.receiver, result.memo].filter(Boolean).join(' · ').slice(0, 120);
  const tx = core.createTransaction(f.id, { type, amount: result.amount, memberId: member.id, categoryId: cat.id, note, date: result.date || todayBkk() }, { source: 'slip', slipRef: result.ref || undefined, slip: core.sanitizeSlip({ bank: result.bank, sender: result.sender, receiver: result.receiver, ref: result.ref, time: result.time, memo: result.memo }) });
  const alerts = await afterExpense(f, tx, member, true);
  const msg = `🧾 สแกนสลิปสำเร็จ\n${type === 'income' ? 'รายรับ' : 'รายจ่าย'} ${f.currency}${fmt(tx.amount)}\n${cat.icon} ${cat.name}${result.receiver ? '\n👤 ' + result.receiver : ''}${result.bank ? '\n🏦 ' + result.bank : ''}\n📅 ${dmy(tx.date)}${result.time ? ' ' + result.time : ''}${alerts.length ? '\n\n' + alerts.join('\n') : ''}`;
  return reply(f, rt, text(msg, ['ลบล่าสุด', type === 'expense' ? 'เปลี่ยนเป็นรายรับ' : 'เปลี่ยนเป็นรายจ่าย', 'สรุป']));
}

async function handleEvent(f, ev) {
  const userId = ev.source?.userId;
  if (ev.type === 'follow') return reply(f, ev.replyToken, text(`สวัสดี! 👋 ยินดีต้อนรับสู่ ${f.name}\nเริ่มต้นโดยผูกบัญชี: ส่ง "ผูก <รหัส 6 หลัก>" (ดูรหัสในแอป ตั้งค่า → LINE OA)\n\n${HELP}`));
  if (ev.type !== 'message' || !userId) return;
  const member = db().members.find(m => m.familyId === f.id && m.lineUserId === userId);

  if (!member) {
    const t = ev.message.type === 'text' ? ev.message.text.trim() : '';
    const m = t.match(/^(?:ผูก|link|เชื่อม)\s*(\d{4,8})$/i);
    if (m) {
      const target = db().members.find(x => x.familyId === f.id && x.linkCode === m[1] && x.linkExpires > Date.now());
      if (!target) return reply(f, ev.replyToken, text('❌ รหัสไม่ถูกต้องหรือหมดอายุ ขอรหัสใหม่ในแอป'));
      target.lineUserId = userId; target.linkCode = null; target.linkExpires = 0; save();
      return reply(f, ev.replyToken, text(`🎉 ผูกบัญชีสำเร็จ: ${av(target)} ${target.name}\nต่อไปนี้พิมพ์บันทึกรายการหรือส่งรูปสลิปได้เลย\n\n${HELP}`));
    }
    return reply(f, ev.replyToken, text('ยังไม่ได้ผูกบัญชี 🔗\nเปิดแอป → ตั้งค่า → LINE OA → กดสร้างรหัสของสมาชิก แล้วส่ง "ผูก <รหัส>" มาที่นี่'));
  }
  if (ev.message.type === 'text') return handleText(f, ev, member);
  if (ev.message.type === 'image') return handleImage(f, ev, member);
  return reply(f, ev.replyToken, text('รองรับข้อความและรูปสลิปเท่านั้นนะ'));
}

// ---- daily summary scheduler (20:00 Bangkok) ----
function startScheduler() {
  setInterval(async () => {
    const now = bkkNow();
    const today = todayBkk();
    if (now.getUTCHours() === 8) { // 08:00 — debt due reminders
      for (const f of db().families) {
        for (const x of db().debts.filter(y => y.familyId === f.id && y.status === 'active' && y.lastRemind !== today)) {
          const dl = core.daysBetween(today, x.dueDate);
          if (dl === 0 || dl === (x.remindDays ?? 1) || dl === -1) {
            x.lastRemind = today; save();
            await notifyFamily(f, flex.debtReminderCard(f, x, dl)).catch(() => {});
          }
        }
      }
      return;
    }
    if (now.getUTCHours() !== 20) return;
    for (const f of db().families) {
      if (!f.notify?.daily || f.lastDaily === today) continue;
      f.lastDaily = today; save();
      const tx = core.famTx(f.id).filter(t => t.date === today);
      const tt = core.totals(tx);
      await notifyFamily(f, flex.dailyCard(f, today, tt, tx.length)).catch(() => {});
    }
  }, 60 * 1000).unref();
}

module.exports = { fetchBotInfo, afterExpense, verifySignature, handleEvent, lineCfg, notifyFamily, push, text, startScheduler, parseCommand };
