'use strict';
// Slip / receipt scanner.
// Provider: Claude vision (set ANTHROPIC_API_KEY). For tests/demos set OCR_MOCK=1.
const { HttpError, todayBkk } = require('./util');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

function buildPrompt(expenseCats, incomeCats) {
  return `คุณคือระบบอ่านสลิปโอนเงินธนาคารไทย (PromptPay / mobile banking), สลิป K+ / SCB Easy / Krungthai NEXT / Bangkok Bank / TTB ฯลฯ และใบเสร็จร้านค้า
อ่านรูปแล้วตอบเป็น JSON เท่านั้น (ห้ามมีข้อความอื่น) ตามรูปแบบ:
{
 "is_slip": true|false,           // รูปนี้เป็นสลิปหรือใบเสร็จจริงหรือไม่
 "amount": number|null,           // ยอดเงิน (บาท) ตัวเลขล้วน
 "date": "YYYY-MM-DD"|null,       // ปี ค.ศ. เสมอ (ถ้าเป็น พ.ศ. ให้ลบ 543)
 "time": "HH:MM"|null,
 "bank": string|null,             // ธนาคารต้นทาง
 "sender": string|null,           // ชื่อผู้โอน
 "receiver": string|null,         // ชื่อผู้รับ / ชื่อร้านค้า
 "ref": string|null,              // เลขที่รายการ / Transaction ID / Ref
 "memo": string|null,             // บันทึกช่วยจำ หรือรายการสินค้าสั้นๆ
 "type": "expense"|"income",      // ปกติสลิปโอนเงิน/ใบเสร็จ = expense; ถ้าเป็นสลิปรับเงินเข้า = income
 "category": string|null          // เลือกจากรายการนี้เท่านั้น
}
หมวดรายจ่าย: ${expenseCats.join(', ')}
หมวดรายรับ: ${incomeCats.join(', ')}
ถ้าอ่านค่าไม่ชัดให้ใส่ null อย่าเดา`;
}

async function viaClaude(buf, mime, prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(501, 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY สำหรับสแกนสลิป');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 700,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } },
        { type: 'text', text: prompt },
      ] }],
    }),
  });
  if (!res.ok) throw new HttpError(502, 'สแกนสลิปไม่สำเร็จ (' + res.status + ')');
  const j = await res.json();
  const text = (j.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new HttpError(502, 'อ่านผลลัพธ์จากสลิปไม่ได้');
  return JSON.parse(m[0]);
}

function normalize(r) {
  const out = { isSlip: r.is_slip !== false, amount: null, date: null, time: null, bank: r.bank || null, sender: r.sender || null, receiver: r.receiver || null, ref: r.ref ? String(r.ref).trim() : null, memo: r.memo || null, type: r.type === 'income' ? 'income' : 'expense', category: r.category || null };
  const a = parseFloat(String(r.amount ?? '').replace(/[,฿\s]/g, ''));
  if (isFinite(a) && a > 0) out.amount = Math.round(a * 100) / 100;
  if (typeof r.date === 'string') {
    const m = r.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      let y = +m[1]; if (y > 2400) y -= 543; // Buddhist era safety net
      const iso = `${y}-${m[2]}-${m[3]}`;
      if (!isNaN(new Date(iso + 'T00:00:00Z'))) out.date = iso;
    }
  }
  if (typeof r.time === 'string' && /^\d{1,2}:\d{2}/.test(r.time)) out.time = r.time.slice(0, 5);
  return out;
}

async function scanSlip(buf, mime, cats) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new HttpError(400, 'รองรับเฉพาะไฟล์รูป (JPG/PNG/WEBP)');
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(413, 'รูปใหญ่เกินไป (สูงสุด 8MB)');
  let raw;
  if (process.env.OCR_MOCK) {
    raw = JSON.parse(process.env.OCR_MOCK === '1'
      ? JSON.stringify({ is_slip: true, amount: 1250, date: todayBkk(), time: '12:41', bank: 'KBank', sender: 'นาย ทดสอบ', receiver: 'ร้านข้าวมันไก่ป้าแดง', ref: 'MOCK' + (Date.now() % 1e9), memo: 'ข้าวมันไก่', type: 'expense', category: 'อาหารและเครื่องดื่ม' })
      : process.env.OCR_MOCK);
  } else {
    raw = await viaClaude(buf, mime, buildPrompt(cats.expense, cats.income));
  }
  return normalize(raw);
}

module.exports = { scanSlip };
