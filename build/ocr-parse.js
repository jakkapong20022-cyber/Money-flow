'use strict';
// Parse OCR text of a Thai bank slip / receipt → fields. Pure function (tested in node, used in browser).
const TH_M = { 'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12 };
const EN_M = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const BANKS = [[/กสิกร|kbank|k\s?plus/i, 'KBank'], [/ไทยพาณิชย์|scb/i, 'SCB'], [/กรุงไทย|krungthai/i, 'Krungthai'], [/กรุงเทพ|bangkok\s?bank|bualuang/i, 'Bangkok Bank'], [/ttb|ทหารไทย/i, 'ttb'], [/กรุงศรี|krungsri/i, 'Krungsri'], [/ออมสิน|gsb/i, 'GSB']];
const pad = (n) => String(n).padStart(2, '0');
function year(y, thai) { y = +y; if (y > 2400) return y - 543; if (y < 100) return thai || y >= 60 ? y + 2500 - 543 : y + 2000; return y; }
function parseSlipText(raw) {
  const t = String(raw || '').replace(/[ \t]+/g, ' ');
  const out = { isSlip: false, amount: null, date: null, time: null, bank: null, sender: null, receiver: null, ref: null, memo: null, type: 'expense', category: null };
  // amount: prefer the number next to a label, else the largest x,xxx.xx
  let m = t.match(/(?:จำนวน(?:เงิน)?|ยอด(?:เงิน)?|amount|total|รวม)\s*[:：]?\s*฿?\s*([\d,]+\.\d{2})/i);
  let amt = m ? m[1] : null;
  if (!amt) { const all = [...t.matchAll(/(\d{1,3}(?:,\d{3})*|\d+)\.\d{2}\b/g)].map(x => x[0]); amt = all.sort((a, b) => parseFloat(b.replace(/,/g, '')) - parseFloat(a.replace(/,/g, '')))[0]; }
  if (amt) out.amount = parseFloat(amt.replace(/,/g, ''));
  // date
  if ((m = t.match(/(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})/))) out.date = `${year(m[3], true)}-${pad(TH_M[m[2]])}-${pad(m[1])}`;
  else if ((m = t.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{2,4})/i))) out.date = `${year(m[3], false)}-${pad(EN_M[m[2].toLowerCase()])}-${pad(m[1])}`;
  else if ((m = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) out.date = `${year(m[3], false)}-${pad(m[2])}-${pad(m[1])}`;
  if (out.date && (+out.date.slice(5, 7) > 12 || +out.date.slice(8) > 31)) out.date = null;
  if ((m = t.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?::[0-5]\d)?\s*(?:น\.|am|pm)?/i))) out.time = `${pad(m[1])}:${m[2]}`;
  if ((m = t.match(/(?:เลขที่รายการ|รหัสอ้างอิง|หมายเลขอ้างอิง|transaction\s*(?:id|no)|ref(?:erence)?\.?(?:\s*no\.?)?)\s*[:：#]?\s*([A-Za-z0-9]{8,})/i))) out.ref = m[1];
  for (const [re, name] of BANKS) if (re.test(t)) { out.bank = name; break; }
  if ((m = t.match(/(?:ไปยัง|ผู้รับ|to)\s*[:：]?\s*\n?\s*((?:นาย|นาง|นางสาว|น\.ส\.|บจก\.|หจก\.|ร้าน|mr\.?|mrs\.?|ms\.?)?[^\n\d]{3,40})/i))) out.receiver = m[1].trim();
  out.isSlip = !!out.amount && (!!out.ref || /โอนเงิน|สำเร็จ|transfer|slip|ใบเสร็จ|receipt|promptpay|พร้อมเพย์/i.test(t));
  return out;
}
if (typeof module !== 'undefined') module.exports = { parseSlipText };
