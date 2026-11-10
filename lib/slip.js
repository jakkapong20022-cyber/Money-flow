'use strict';
// Slip / receipt scanner.
// AI vision providers: Claude / GPT (OpenAI) / Gemini. For tests/demos set OCR_MOCK=1.
const { HttpError, todayBkk } = require('./util');

// Providers (any one is enough; several = automatic fallback in this order, or set OCR_PROVIDER=gemini,openai,claude):
//   claude → ANTHROPIC_API_KEY (ANTHROPIC_MODEL)   openai → OPENAI_API_KEY (OPENAI_MODEL)   gemini → GEMINI_API_KEY (GEMINI_MODEL)
const MODELS = {
  claude: () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  openai: () => process.env.OPENAI_MODEL || 'gpt-4o',
  gemini: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash',
};
const KEYS = { claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
const LABEL = { claude: 'Claude', openai: 'GPT', gemini: 'Gemini' };
let doFetch = (...a) => fetch(...a); // swappable in tests

const hasKey = (p) => !!(process.env[KEYS[p]] || (p === 'gemini' && process.env.GOOGLE_API_KEY));
function providers() {
  const pref = String(process.env.OCR_PROVIDER || '').toLowerCase().split(/[\s,]+/).filter(p => KEYS[p]);
  const order = [...new Set([...pref, 'claude', 'gemini', 'openai'])];
  return order.filter(hasKey);
}
const providerInfo = () => providers().map(p => ({ id: p, label: LABEL[p], model: MODELS[p]() }));

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
กติกาสำหรับ "บิลเงินสด / ใบเสร็จร้านค้า / ใบกำกับภาษี / ใบเสร็จรับเงินที่พิมพ์หรือเขียนมือ":
- amount = ยอดรวมสุทธิที่ต้องจ่าย (รวมทั้งสิ้น / Grand Total / Total / ยอดสุทธิ) — ห้ามใช้ยอดก่อนภาษี ยอดเงินสดที่ลูกค้าให้ (Cash/Tendered) หรือเงินทอน (Change)
- receiver = ชื่อร้าน/บริษัทบนหัวบิล, memo = สรุปรายการสินค้า/บริการ 1 บรรทัด (ไม่เกิน 60 ตัวอักษร)
- ref = เลขที่ใบเสร็จ/Receipt No./Invoice No. ถ้ามี, sender = null, type = expense
- บิลที่ถ่ายเอียง ยับ หรือมีเงา ให้พยายามอ่านให้ได้ แต่ถ้าตัวเลขยอดรวมไม่ชัดให้ amount = null
ถ้าอ่านค่าไม่ชัดให้ใส่ null อย่าเดา`;
}

const parseJson = (text) => {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new HttpError(502, 'อ่านผลลัพธ์จากสลิปไม่ได้');
  return JSON.parse(m[0]);
};
async function post(provider, url, headers, body) {
  const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new HttpError(502, `${LABEL[provider]} สแกนไม่สำเร็จ (${res.status})`);
  return res.json();
}
const ENGINES = {
  async claude(buf, mime, prompt) {
    const j = await post('claude', 'https://api.anthropic.com/v1/messages', { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, {
      model: MODELS.claude(), max_tokens: 700,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } }, { type: 'text', text: prompt }] }] });
    return parseJson((j.content || []).map(c => c.text || '').join(''));
  },
  async openai(buf, mime, prompt) {
    const j = await post('openai', 'https://api.openai.com/v1/chat/completions', { authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, {
      model: MODELS.openai(), response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}`, detail: 'high' } }] }] });
    return parseJson(j.choices?.[0]?.message?.content);
  },
  async gemini(buf, mime, prompt) {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const j = await post('gemini', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODELS.gemini())}:generateContent`, { 'x-goog-api-key': key }, {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: buf.toString('base64') } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
    return parseJson((j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''));
  },
};
// Try each configured provider in order; a provider that errors or finds no amount hands over to the next one.
async function readWithProviders(buf, mime, prompt) {
  const list = providers();
  if (!list.length) throw new HttpError(501, 'ยังไม่ได้ตั้งค่า API key สำหรับสแกนสลิป (ANTHROPIC_API_KEY, GEMINI_API_KEY หรือ OPENAI_API_KEY)');
  let best = null, lastErr = null;
  for (const p of list) {
    try {
      const r = await ENGINES[p](buf, mime, prompt); r.__provider = p;
      const amt = parseFloat(String(r.amount ?? '').replace(/[,฿\s]/g, ''));
      if (r.is_slip !== false && isFinite(amt) && amt > 0) return r; // good read
      best = best || r;                                                // keep as fallback (e.g. "not a slip")
    } catch (e) { lastErr = e; console.warn('[slip]', p, e.message); }
  }
  if (best) return best;
  throw lastErr || new HttpError(502, 'สแกนสลิปไม่สำเร็จ');
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
    raw = await readWithProviders(buf, mime, buildPrompt(cats.expense, cats.income));
  }
  const out = normalize(raw); out.provider = raw.__provider || (process.env.OCR_MOCK ? 'mock' : null); return out;
}

module.exports = { scanSlip, providers, providerInfo, __setFetch: (f) => { doFetch = f; } };
