'use strict';
// LINE Flex Message cards (dark theme to match the app). Every builder returns a complete message
// { type:'flex', altText, contents } — altText is the plain-text version shown in notification previews.
const { fmt, dmy } = require('./util');

const C = { bg: '#0f1420', card: '#171e2e', text: '#eef2f8', muted: '#8a95a8', green: '#2ee59d', red: '#ff4d6d', blue: '#3d8bff', orange: '#ffb020', line: '#ffffff1f' };
const s = (v, n = 60) => { v = String(v ?? '').trim(); return (v.length > n ? v.slice(0, n - 1) + '…' : v) || '-'; };
const t = (text, o = {}) => ({ type: 'text', text: s(text, o.max || 80), wrap: true, size: o.size || 'sm', color: o.color || C.text, ...(o.weight ? { weight: o.weight } : {}), ...(o.align ? { align: o.align } : {}), ...(o.flex != null ? { flex: o.flex } : {}) });
const row = (label, value, color) => ({ type: 'box', layout: 'horizontal', spacing: 'md', contents: [t(label, { color: C.muted, size: 'xs', flex: 3 }), t(value, { color, align: 'end', flex: 5 })] });
const sep = () => ({ type: 'separator', margin: 'md', color: C.line });
const bar = (pct, color) => ({ type: 'box', layout: 'vertical', height: '6px', cornerRadius: '3px', backgroundColor: '#ffffff14', margin: 'xs',
  contents: [{ type: 'box', layout: 'vertical', width: Math.max(2, Math.min(100, Math.round(pct))) + '%', height: '6px', cornerRadius: '3px', backgroundColor: color, contents: [{ type: 'filler' }] }] });
function card(altText, accent, title, bodyContents) {
  return { type: 'flex', altText: s(altText, 380), contents: { type: 'bubble', size: 'kilo',
    styles: { body: { backgroundColor: C.bg }, header: { backgroundColor: C.card }, footer: { backgroundColor: C.bg } },
    header: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: [t(title, { weight: 'bold', color: accent, size: 'sm' })] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: bodyContents } } };
}

function txCard(f, tx, cat, actorName) {
  const inc = tx.type === 'income', col = inc ? C.green : C.red, label = inc ? '💰 รายรับ' : '💸 รายจ่าย';
  const body = [t(`${inc ? '+' : '-'}${f.currency}${fmt(tx.amount)}`, { size: 'xxl', weight: 'bold', color: col, max: 24 }), sep(),
    row('หมวด', `${cat?.icon || ''} ${cat?.name || '-'}`.trim()), row('โดย', actorName), row('วันที่', dmy(tx.date))];
  if (tx.note) body.push(row('บันทึก', tx.note));
  return card(`${label} ${actorName}: ${f.currency}${fmt(tx.amount)} · ${cat?.name || ''}${tx.note ? ' (' + tx.note + ')' : ''}`, col, label, body);
}

function summaryCard(f, sm, mine, plain) {
  const top = sm.categories.slice(0, 4), max = Math.max(1, ...top.map(c => c.amount));
  const body = [t('คงเหลือรวม', { color: C.muted, size: 'xs' }), t(`${f.currency}${fmt(sm.balance)}`, { size: 'xxl', weight: 'bold', color: sm.balance >= 0 ? C.green : C.red, max: 24 }),
    { type: 'box', layout: 'horizontal', margin: 'md', contents: [
      { type: 'box', layout: 'vertical', flex: 1, contents: [t('รายรับ', { color: C.muted, size: 'xs' }), t(fmt(sm.income), { color: C.green, weight: 'bold' })] },
      { type: 'box', layout: 'vertical', flex: 1, contents: [t('รายจ่าย', { color: C.muted, size: 'xs' }), t(fmt(sm.expense), { color: C.red, weight: 'bold' })] }] }];
  if (top.length) { body.push(sep(), t('หมวดที่ใช้มากสุด', { color: C.muted, size: 'xs' })); for (const c of top) body.push({ type: 'box', layout: 'vertical', margin: 'sm', contents: [{ type: 'box', layout: 'horizontal', contents: [t(`${c.icon || ''} ${c.name}`, { flex: 5 }), t(fmt(c.amount), { align: 'end', flex: 3, color: C.muted })] }, bar(c.amount / max * 100, c.color || C.blue)] }); }
  if (mine) body.push(sep(), row(`ของ ${mine.name}`, `จ่าย ${fmt(mine.spent)}${mine.budget ? ' / งบ ' + fmt(mine.budget) : ''}`, mine.budget && mine.spent > mine.budget ? C.red : C.text));
  return card(plain, C.blue, `📊 สรุปเดือน ${sm.month.slice(5)}/${sm.month.slice(0, 4)}`, body);
}

const dueText = (x) => x.overdue || x.daysLeft < 0 ? `⚠️ เกินกำหนด ${-x.daysLeft} วัน` : x.daysLeft === 0 ? 'ครบกำหนดวันนี้' : `อีก ${x.daysLeft} วัน`;
const dueColor = (x) => x.daysLeft < 0 ? C.red : x.daysLeft <= 7 ? C.orange : C.blue;
function debtListCard(f, items, total, plain) {
  const body = [t('คงเหลือรวม', { color: C.muted, size: 'xs' }), t(`${f.currency}${fmt(total)}`, { size: 'xxl', weight: 'bold', color: C.orange, max: 24 }), sep()];
  for (const x of items.slice(0, 6)) body.push({ type: 'box', layout: 'vertical', margin: 'md', contents: [
    { type: 'box', layout: 'horizontal', contents: [t(x.name, { weight: 'bold', flex: 5 }), t(`${f.currency}${fmt(Math.min(x.installment || x.remaining, x.remaining))}`, { align: 'end', flex: 3 })] },
    t(`${dueText(x)} · ${dmy(x.dueDate)}`, { color: dueColor(x), size: 'xs' })] });
  return card(plain, C.orange, '💳 หนี้สิน', body);
}

function debtReminderCard(f, x, dl) {
  const head = dl < 0 ? '⏰ เกินกำหนดชำระแล้ว' : dl === 0 ? '⏰ วันนี้ครบกำหนดชำระ' : `⏰ อีก ${dl} วันครบกำหนดชำระ`;
  const amt = Math.min(x.installment || x.remaining, x.remaining), col = dl < 0 ? C.red : dl <= 1 ? C.orange : C.blue;
  return card(`${head}\n💳 ${x.name} ${f.currency}${fmt(amt)}\nกำหนด ${dmy(x.dueDate)}`, col, head,
    [t(x.name, { weight: 'bold', size: 'lg' }), t(`${f.currency}${fmt(amt)}`, { size: 'xxl', weight: 'bold', color: col, max: 24 }), sep(), row('กำหนดชำระ', dmy(x.dueDate)), row('คงเหลือรวม', `${f.currency}${fmt(x.remaining)}`)]);
}

function dailyCard(f, today, tt, count) {
  return card(`🌙 สรุปวันนี้ (${dmy(today)})\nรายรับ ${fmt(tt.income)} | รายจ่าย ${fmt(tt.expense)}\n${count} รายการ`, C.blue, `🌙 สรุปวันนี้ · ${dmy(today)}`,
    [{ type: 'box', layout: 'horizontal', contents: [
      { type: 'box', layout: 'vertical', flex: 1, contents: [t('รายรับ', { color: C.muted, size: 'xs' }), t(`${f.currency}${fmt(tt.income)}`, { color: C.green, weight: 'bold', size: 'lg' })] },
      { type: 'box', layout: 'vertical', flex: 1, contents: [t('รายจ่าย', { color: C.muted, size: 'xs' }), t(`${f.currency}${fmt(tt.expense)}`, { color: C.red, weight: 'bold', size: 'lg' })] }] },
     sep(), t(`${count} รายการวันนี้`, { color: C.muted, size: 'xs' })]);
}

module.exports = { txCard, summaryCard, debtListCard, debtReminderCard, dailyCard };
