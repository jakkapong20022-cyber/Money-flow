(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.ICS = factory(); })(this, function () {
  'use strict';
  // iCalendar (.ics) builder for debt due dates — opens in iPhone/Android/Google/Outlook calendars.
  const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
  const fmtN = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  function fold(line) { // RFC5545: max 75 octets per line, continuation lines start with a space
    const out = []; let cur = '', bytes = 0;
    for (const ch of line) {
      const b = new TextEncoder().encode(ch).length;
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += b;
    }
    out.push(cur); return out.join('\r\n ');
  }
  // 09:00 Asia/Bangkok (UTC+7) expressed in UTC
  function utc(date, h, m) {
    const [y, mo, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h - 7, m)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  const amountOf = (x) => Math.min(x.installment || x.remaining, x.remaining) || x.remaining;
  function rrule(x) {
    if (x.kind !== 'monthly') return '';
    return 'FREQ=MONTHLY' + (x.dueDay > 28 ? ';BYMONTHDAY=-1' : '') + (x.installmentsLeft > 0 ? `;COUNT=${x.installmentsLeft}` : '');
  }
  function summary(x, cur) { return `💳 ชำระ ${x.name} ${cur}${fmtN(amountOf(x))}`; }
  function description(x, cur) {
    return [x.creditor && `เจ้าหนี้: ${x.creditor}`, `ยอดคงเหลือ: ${cur}${fmtN(x.remaining)}`, x.kind === 'monthly' && x.installmentsLeft > 0 && `เหลืออีก ${x.installmentsLeft} งวด`, x.note].filter(Boolean).join('\n');
  }
  function vevent(x, cur, stamp) {
    const L = ['BEGIN:VEVENT', `UID:${x.id}@family-budget`, `DTSTAMP:${stamp}`, `DTSTART:${utc(x.dueDate, 9, 0)}`, `DTEND:${utc(x.dueDate, 9, 30)}`,
      `SUMMARY:${esc(summary(x, cur))}`, `DESCRIPTION:${esc(description(x, cur))}`];
    const rr = rrule(x); if (rr) L.push('RRULE:' + rr);
    L.push('TRANSP:TRANSPARENT');
    const days = x.remindDays ?? 1;
    if (days > 0) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('ใกล้ครบกำหนด: ' + summary(x, cur))}`, `TRIGGER:-P${days}D`, 'END:VALARM');
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('วันนี้ครบกำหนด: ' + summary(x, cur))}`, 'TRIGGER:PT0S', 'END:VALARM', 'END:VEVENT');
    return L;
  }
  function calendar(debts, opts = {}) {
    const cur = opts.cur || '฿', stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Family Budget//Debts//TH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(opts.name || 'หนี้สิน')}`, 'X-WR-TIMEZONE:Asia/Bangkok', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H'];
    for (const x of debts) if (x.status === 'active' && x.dueDate) L.push(...vevent(x, cur, stamp));
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  function googleUrl(x, cur = '฿') {
    const s = utc(x.dueDate, 9, 0), e = utc(x.dueDate, 9, 30), rr = rrule(x);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(summary(x, cur)) + '&details=' + encodeURIComponent(description(x, cur)) + `&dates=${s}/${e}` + (rr ? '&recur=' + encodeURIComponent('RRULE:' + rr) : '');
  }
  return { calendar, googleUrl, summary };
});
