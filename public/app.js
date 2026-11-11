'use strict';
/* Family Budget — single-file SPA (vanilla JS, no build step) */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const bkk = () => new Date(Date.now() + 7 * 3600e3).toISOString();
const today = () => bkk().slice(0, 10);
const ym = () => bkk().slice(0, 7);
const EMOJIS = ['👨', '👩', '🧒', '👧', '👦', '👴', '👵', '🧑', '👶', '🐶', '😎', '🙂'];
const COLORS = ['#3d8bff', '#ff5d8f', '#f5d000', '#2ee59d', '#a66bff', '#ff8a3d'];
const CAT_ICONS = ['🍽️', '🚗', '📚', '💡', '🎮', '🛍️', '💊', '🧸', '🏠', '📦', '✈️', '🐶', '💼', '🎁', '📈', '☕', '🎓', '🔧'];

const isImg = (a) => String(a || '').startsWith('data:image/');
const avHTML = (a) => isImg(a) ? `<img src="${a}" alt="">` : (AV_E[a] ? ico(AV_E[a]) : esc(a));
const emoji = (a) => isImg(a) ? ico('user', 'inl') : (AV_E[a] ? ico(AV_E[a], 'inl') : esc(a));
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THMONTH = (m) => `${TH_MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m, n) => { const t = +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1) + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
// Dates are shown/typed as dd/mm/yyyy (ค.ศ.) and stored as ISO yyyy-mm-dd.
const dmy = (d) => d ? String(d).split('-').reverse().join('/') : '';
const parseDMY = (t) => {
  const m = String(t || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) return '';
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, dt = new Date(iso + 'T00:00:00Z');
  return !isNaN(dt) && dt.toISOString().slice(0, 10) === iso ? iso : '';
};
const BADDATE = 'รูปแบบวันที่ต้องเป็น วว/ดด/ปปปป เช่น 31/12/2026';
const dateField = (id, iso) => `<div class="dfield"><input class="i" id="${id}" type="text" inputmode="numeric" placeholder="วว/ดด/ปปปป" maxlength="10" autocomplete="off" data-df value="${dmy(iso)}"><button type="button" class="dcal" data-act="dpick" data-for="${id}" aria-label="เลือกวันที่">📅</button><input type="date" class="pickdate" tabindex="-1" aria-hidden="true" data-pick="${id}"></div>`;
const getDate = (id) => parseDMY($('#' + id)?.value);
const dueLabel = (x) => x.daysLeft < 0 ? `เกินกำหนด ${-x.daysLeft} วัน` : x.daysLeft === 0 ? 'ครบกำหนดวันนี้' : `อีก ${x.daysLeft} วัน`;
const dueColor = (x) => x.daysLeft < 0 ? 'var(--red)' : x.daysLeft <= 7 ? 'var(--orange)' : 'var(--blue)';
const S = {
  token: localStorage.getItem('fb_token'), me: null, cats: [], view: 'home', month: ym(),
  authTab: 'login', setup: null, openCats: {}, catTab: 'expense',
  add: null, mv: { id: null, range: 'month', from: today(), to: today() },
  rp: { range: 'month', member: '', from: today(), to: today() }, rpData: null,
};
const app = $('#app');
const cur = () => S.me?.family?.currency || '฿';

/* ---------- helpers ---------- */
async function api(path, method = 'GET', body) {
  if (window.LOCAL) return window.LOCAL.handle(method, path, body);
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (method !== 'GET') S.lastMut = Date.now();
  const ct = r.headers.get('content-type') || '';
  const j = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (r.status === 401 && S.token) { logout(true); throw new Error('เซสชันหมดอายุ'); }
  if (!r.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
  return j;
}
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = stripE(msg); t.style.top = (18 + document.querySelectorAll('.toast').length * 56) + 'px'; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'err'); } };
function modal(html) {
  closeModal();
  const o = document.createElement('div'); o.className = 'ov'; o.id = 'modal';
  o.innerHTML = fx(`<div class="sheet">${html}</div>`);
  o.addEventListener('click', e => { if (e.target === o) closeModal(); });
  document.body.appendChild(o); return o;
}
const closeModal = () => $('#modal')?.remove();
const member = (id) => S.me.members.find(m => m.id === id);
const mains = (type) => S.cats.filter(c => c.type === type && !c.parentId);
const subs = (id) => S.cats.filter(c => c.parentId === id);
async function refreshMe() { S.me = await api('/me'); }
async function refreshCats() { S.cats = await api('/categories'); }
function logout(silent) { stopLive(); localStorage.removeItem('fb_token'); if (!silent && S.token) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token } }); S.token = null; S.me = null; go('auth'); }

/* ---------- router ---------- */
/* ---------- icon set (neon line icons, inherit colour) ---------- */
const IC_P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2A6.5 6.5 0 0 1 21.5 20"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  chat: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13h5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10a4 4 0 0 1-.5 8z"/><path d="M12 11v6M9.5 14.5 12 17l2.5-2.5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>',
  cal: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
};
const ico = (k, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC_P[k] || ''}</svg>`;
// settings card header: neon icon chip + title (+ optional right-side html)
const sh = (k, title, right = '', tone = 'green') => `<div class="sh"><span class="chipi ${tone}">${ico(k)}</span><h3>${title}</h3>${right ? `<span class="shr">${right}</span>` : ''}</div>`;


Object.assign(IC_P, {
  food: '<path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10"/><path d="M17 21V3c-2.5 1.5-3.5 4-3.5 7v3H17"/>',
  car: '<circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M5.5 17H4a1 1 0 0 1-1-1v-4l2-5.5A2 2 0 0 1 6.9 5h10.2A2 2 0 0 1 19 6.5L21 12v4a1 1 0 0 1-1 1h-1.5M9.5 17h5M3 12h18"/>',
  book: '<path d="M4 19V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13"/><path d="M9 7.5h6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  game: '<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7 10.5v4M5 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
  pulse: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/><path d="M8 12h2.5l1.5-3 2 5 1.5-2H17"/>',
  stroller: '<circle cx="8" cy="19" r="1.7"/><circle cx="17" cy="19" r="1.7"/><path d="M3 4h2l2.5 11h10M7 8h13a7 7 0 0 1-7 7"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
  plane: '<path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="M10 13 21 3"/>',
  paw: '<circle cx="7" cy="11" r="1.8"/><circle cx="10.5" cy="6.8" r="1.8"/><circle cx="14.5" cy="6.8" r="1.8"/><circle cx="18" cy="11" r="1.8"/><path d="M12.5 12.5c-3 0-5 3-5 5 0 1.6 1.5 2.5 3 2s1.2-.5 2-.5 1 .5 2 .5c1.5.5 3-.4 3-2 0-2-2-5-5-5z"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18M11 13v2h2v-2"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8C10 8 8 7 8 5.5S10 3 12 8c2-5 4-3.5 4-2.500S14 8 12 8"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  coffee: '<path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.500 2.500 0 0 1 0 5H17M8 3v3M12 3v3"/>',
  cap: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11.500V16c0 1.500 3 3 6 3s6-1.500 6-3v-4.500M22 9v6"/>',
  wrench: '<path d="M14.500 5.500a4 4 0 0 0 4.500 5.500L10 20a2.100 2.100 0 0 1-3-3l9-9"/><path d="M14.500 5.500 17 3l4 4-2.500 2.500"/>',
  store: '<path d="m4 9 1.500-5h13L20 9"/><path d="M4 9a2.700 2.700 0 0 0 5.300 0 2.700 2.700 0 0 0 5.400 0A2.700 2.700 0 0 0 20 9M5 12v8h14v-8M10 20v-5h4v5"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.800 9c-.4-1-1.400-1.500-2.800-1.500-1.700 0-2.800.8-2.800 2s1 1.700 2.800 2 2.800.8 2.800 2-1.100 2-2.800 2c-1.400 0-2.400-.5-2.800-1.500M12 6v1.500M12 16.500V18"/>',
  folder: '<path d="M3 6.500A1.500 1.500 0 0 1 4.500 5H9l2 2.500h8.500A1.500 1.500 0 0 1 21 9v9a1.500 1.500 0 0 1-1.500 1.500h-15A1.500 1.500 0 0 1 3 18z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  pencil: '<path d="M4 20h4L19 9a2.800 2.800 0 0 0-4-4L4 16z"/><path d="m13.500 6.500 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  camera: '<path d="M4 8h3l1.500-2.500h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.500" r="3.500"/>',
  bank: '<path d="M3 9.500 12 4l9 5.500M5 9.500V18M9.500 9.500V18M14.500 9.500V18M19 9.500V18M3 21h18M3 18h18"/>',
  alert: '<path d="M12 4 2.500 20h19z"/><path d="M12 10v4.500M12 17.500v.01"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v3"/><path d="M4 7v11a2 2 0 0 0 2 2h14V8H6a2 2 0 0 1-2-1"/><path d="M16 14h.01"/>',
  scale: '<path d="M12 4v16M7 20h10M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  aur: '<path d="M7 17 17 7M8 7h9v9"/>', adr: '<path d="M7 7l10 10M17 8v9H8"/>',
  aup: '<path d="M12 19V5M6 11l6-6 6 6"/>', adn: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  pdf: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  phone: '<rect x="7" y="2.500" width="10" height="19" rx="2.500"/><path d="M11 18h2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  house2: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10M10 20v-5h4v5"/>',
  leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15"/><path d="M5 19c3-5 6-8 10-10"/>',
  /* avatars */
  a_man: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  a_woman: '<circle cx="12" cy="8" r="3.5"/><path d="M15.200 6.200c2.300-.3 3.800 1.300 3.300 4.300M4.500 21a7.500 7.500 0 0 1 15 0"/>',
  a_kid: '<circle cx="12" cy="10" r="3"/><path d="M6 21a6 6 0 0 1 12 0M10.500 5.500c.5-1 2.500-1 3 0"/>',
  a_girl: '<circle cx="12" cy="10" r="3"/><circle cx="6.500" cy="8.500" r="1.300"/><circle cx="17.500" cy="8.500" r="1.300"/><path d="M6 21a6 6 0 0 1 12 0"/>',
  a_boy: '<circle cx="12" cy="10" r="3"/><path d="M8.500 8.500h7M9.500 8.500c0-2 1-3 2.500-3s2.500 1 2.500 3M6 21a6 6 0 0 1 12 0"/>',
  a_elder: '<circle cx="12" cy="8" r="4"/><circle cx="10.300" cy="8" r="1.200"/><circle cx="13.700" cy="8" r="1.200"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  a_elderw: '<circle cx="12" cy="9" r="3.500"/><circle cx="12" cy="3.800" r="1.600"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  a_user2: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0M9 15.500l3 3 3-3"/>',
  a_baby: '<circle cx="12" cy="12" r="7.500"/><path d="M12 4.500c0-1.500 1-2 2.500-2M9.500 11.500h.01M14.500 11.500h.01M10 15c1.200 1 2.800 1 4 0"/>',
  a_cool: '<circle cx="12" cy="12" r="9"/><path d="M6.500 10h11M7 10v2.500a2 2 0 0 0 4 0V10M13 10v2.500a2 2 0 0 0 4 0V10M9.500 16.500c1.500 1 3.500 1 5 0"/>',
  a_smile: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8.500 14.500c1 2 2.200 2.800 3.500 2.800s2.500-.8 3.500-2.800"/>',
  a_paw: '<circle cx="7" cy="11" r="1.800"/><circle cx="10.500" cy="6.800" r="1.800"/><circle cx="14.500" cy="6.800" r="1.800"/><circle cx="18" cy="11" r="1.800"/><path d="M12.500 12.500c-3 0-5 3-5 5 0 1.600 1.500 2.500 3 2s1.200-.5 2-.5 1 .5 2 .5c1.500.5 3-.4 3-2 0-2-2-5-5-5z"/>',
});
// legacy / stored emoji (kept as ids in the data) -> icon key
const IC_E = {
  '🍽️':'food','🍽':'food','🚗':'car','📚':'book','💡':'bulb','🎮':'game','🛍️':'bag','🛍':'bag','💊':'pulse','🧸':'stroller','🏠':'home','🏡':'house2',
  '💳':'card','📦':'box','✈️':'plane','✈':'plane','💼':'brief','🎁':'gift','📈':'trend','☕':'coffee','🎓':'cap','🔧':'wrench','🛒':'store','💰':'coin','💸':'coin',
  '📁':'folder','🎯':'target','✓':'check','✅':'check','✎':'pencil','🗑':'trash','👤':'user','📷':'camera','🏦':'bank','⚠️':'alert','⚠':'alert','🧾':'receipt',
  '👛':'wallet','⚖️':'scale','⚖':'scale','↗':'aur','↘':'adr','↑':'aup','↓':'adn','📄':'pdf','📲':'phone','📅':'cal','🔑':'key','☁️':'cloud','☁':'cloud',
  '⬇️':'download','⬇':'download','💬':'chat','🌿':'leaf','🎉':'check'
};
const AV_E = {'👨':'a_man','👩':'a_woman','🧒':'a_kid','👧':'a_girl','👦':'a_boy','👴':'a_elder','👵':'a_elderw','🧑':'a_user2','👶':'a_baby','🐶':'a_paw','😎':'a_cool','🙂':'a_smile'};
const ALL_E = Object.assign({}, IC_E, AV_E);
const E_RE = new RegExp('(' + Object.keys(ALL_E).sort((a, b) => b.length - a.length).join('|') + ')\\uFE0F?', 'g');
// swap UI emoji for line icons in text nodes only (never inside tags/attributes)
const fx = (html) => String(html).split(/(<[^>]*>)/).map(seg => seg[0] === '<' ? seg : seg.replace(E_RE, (m, e) => ico(ALL_E[e], 'inl'))).join('');
const stripE = (t) => String(t).replace(E_RE, '').replace(/\s{2,}/g, ' ').trim();
// colour tile for a category icon (stored emoji id or custom text)
const ci = (icon, color, cls = '') => `<span class="tl ${cls}" style="--c:${color || '#3d8bff'}">${IC_E[icon] ? ico(IC_E[icon]) : `<b>${esc(icon || '')}</b>`}</span>`;

const NAV = [['home', 'home', 'หน้าแรก'], ['cats', 'grid', 'หมวดหมู่'], ['add', 'plus', 'เพิ่ม'], ['debts', 'card', 'หนี้สิน'], ['reports', 'chart', 'รายงาน']];
const nav = () => `<nav class="bn">${NAV.map(([k, ic, lb]) => `<button class="${k === 'add' ? 'plus' : ''} ${S.view === k || (k === 'home' && S.view === 'member') ? 'on' : ''}" data-act="nav" data-v="${k}"><b>${ico(ic)}</b>${lb}</button>`).join('')}</nav>`;
async function go(view, opts = {}) {
  S.view = view; Object.assign(S, opts);
  await render();
  window.scrollTo(0, 0);
}
async function render() {
  const noNav = ['auth', 'setup'];
  try {
    const html = await V[S.view]();
    app.innerHTML = fx(noNav.includes(S.view) ? html : `${S.view === 'settings' ? '' : `<button class="gear" data-act="nav" data-v="settings" aria-label="ตั้งค่า">${ico('gear')}</button>`}<main>${html}</main>${nav()}`);
    AFTER[S.view]?.();
  } catch (e) { toast(e.message, 'err'); }
}
const back = (to = 'home') => `<div class="bar-top"><button class="back" data-act="nav" data-v="${to}">‹</button>`;

/* ---------- shared UI pieces ---------- */
function avatars(sel, act, size = '') {
  return `<div class="avs">${S.me.members.map(m => `<button class="av ${size} ${sel === m.id ? 'sel' : ''}" style="--c:${m.color}" data-act="${act}" data-id="${m.id}"><span class="chk">✓</span><i>${avHTML(m.avatar)}</i>${esc(m.name)}</button>`).join('')}</div>`;
}
function donut(items, centerTop, centerBot, botColor = '#eef2f8') {
  const R = 38, C = 2 * Math.PI * R; let off = 0;
  const tot = items.reduce((s, i) => s + i.amount, 0);
  let lens = items.map(i => tot && i.amount > 0 ? Math.max(i.amount / tot * C, C * 0.02) : 0); // keep tiny slices visible
  const sum = lens.reduce((a, b) => a + b, 0) || 1; lens = lens.map(l => l * C / sum);
  const arcs = tot ? items.map((i, k) => { const len = lens[k]; const s = len ? `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${i.color}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)" style="filter:drop-shadow(0 0 3px ${i.color})"/>` : ''; off += len; return s; }).join('') : `<circle cx="60" cy="60" r="${R}" fill="none" stroke="#1d2533" stroke-width="16"/>`;
  return `<svg viewBox="0 0 120 120">${arcs}<text x="60" y="57" text-anchor="middle" fill="#8a95a8" font-size="8">${esc(centerTop)}</text><text x="60" y="72" text-anchor="middle" fill="${botColor}" font-size="12" font-weight="700">${esc(centerBot)}</text></svg>`;
}
function txRow(t) {
  const sign = t.type === 'income' ? '+' : '-';
  return `<button class="tx" style="--c:${t.color || '#3d8bff'}" data-act="txopen" data-id="${t.id}">${ci(t.icon || '💸', t.color)}<span class="grow"><b>${esc(t.note || t.categoryName)}</b><div class="muted small">${esc(t.categoryName)} · ${esc(t.memberAvatar || '')} ${esc(t.memberName || '')} · ${dmy(t.date)}</div></span><span class="amt ${t.type === 'income' ? 'green' : 'redc'}">${sign}${cur()}${fmt(t.amount)}</span></button>`;
}
const empty = (t) => `<div class="empty">${t}</div>`;

/* ---------- views ---------- */
const V = {}, AFTER = {};

V.auth = async () => `<div class="auth">
  <div class="logo">${ico('house2')}</div>
  <h1 class="center" style="font-size:28px">Family Budget</h1>
  <p class="center muted">จัดการรายรับรายจ่ายของทั้งครอบครัว<br>บันทึกผ่านแอปหรือ LINE พร้อมสแกนสลิป</p>
  <div class="gap"></div>
  <div class="seg"><button class="${S.authTab === 'login' ? 'on' : ''}" data-act="authtab" data-t="login">เข้าสู่ระบบ</button><button class="${S.authTab === 'code' ? 'on' : ''}" data-act="authtab" data-t="code">รหัสจากผู้ดูแล</button><button class="${S.authTab === 'register' ? 'on' : ''}" data-act="authtab" data-t="register">สมัครสมาชิก</button></div>
  ${S.authTab === 'code' ? `<form id="codeForm" autocomplete="off">
    <p class="muted small" style="margin:12px 0 0">ขอรหัสเข้าใช้งานจากผู้ดูแลครอบครัว (ที่ ตั้งค่า → รหัสเข้าใช้งาน) แล้วกรอกด้านล่าง — รหัสใช้ได้ครั้งเดียวภายใน 24 ชั่วโมง</p>
    <label class="f">รหัสลับ</label><input class="i" name="code" placeholder="XXXX-XXXX" autocapitalize="characters" autocomplete="off" required style="letter-spacing:3px;text-align:center;font-size:20px">
    <div class="gap"></div><button class="btn" type="submit">เข้าใช้งาน</button></form>` : `<form id="authForm" autocomplete="on">
    ${S.authTab === 'register' ? `<label class="f">ชื่อของคุณ</label><input class="i" name="name" placeholder="เช่น พ่อ" required>` : ''}
    <label class="f">เบอร์โทรศัพท์</label><input class="i" name="phone" type="tel" inputmode="tel" autocomplete="username" placeholder="0812345678" required>
    <label class="f">รหัสผ่าน</label><input class="i" name="password" type="password" minlength="6" autocomplete="${S.authTab === 'login' ? 'current-password' : 'new-password'}" required>
    <div class="gap"></div><button class="btn" type="submit">${S.authTab === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}</button>
  </form>`}</div>`;

V.setup = async () => {
  if (!S.setup) S.setup = { name: '', currency: '฿', members: [{ name: 'พ่อ', avatar: '👨' }, { name: 'แม่', avatar: '👩' }, { name: 'ลูก', avatar: '🧒' }] };
  const st = S.setup;
  return `<div class="auth"><div class="logo">${ico('house2')}</div><h2 class="center">ตั้งค่าครอบครัว</h2><p class="center muted small">ขั้นตอนสุดท้ายก่อนเริ่มใช้งาน</p>
  <label class="f">ชื่อครอบครัว</label><input class="i" id="sfName" value="${esc(st.name)}" placeholder="เช่น บ้านสุขสันต์">
  <label class="f">สกุลเงิน</label><select class="i" id="sfCur">${['฿', '$', '€', '£', '¥', '₹'].map(c => `<option ${st.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
  <div class="sec">สมาชิกในครอบครัว</div>
  ${st.members.map((m, i) => `<div class="row" style="margin-bottom:8px"><button class="back" data-act="sfavatar" data-i="${i}" style="font-size:20px"><span class="mini">${avHTML(m.avatar)}</span></button><input class="i grow sfm" data-i="${i}" value="${esc(m.name)}" placeholder="ชื่อสมาชิก"><button class="ib" data-act="sfdel" data-i="${i}">✕</button></div>`).join('')}
  <button class="btn ghost sm" data-act="sfadd">＋ เพิ่มสมาชิก</button>
  <div class="gap"></div><button class="btn" data-act="sfdone">เริ่มใช้งาน</button></div>`;
};

V.home = async () => {
  const s = await api('/summary?month=' + S.month);
  S.sum = s; const net = s.net ?? (s.income - s.expense);
  const bcol = (p) => p >= 100 ? 'var(--red)' : p >= 75 ? '#f5b800' : 'var(--green)';
  const fp = (a, t) => { const p = t ? a / t * 100 : 0; return (p === 0 || p >= 10 ? Math.round(p) : Math.round(p * 10) / 10) + '%'; };
  const legend = (items) => `<div class="lg">${items.map(c => `<span><i style="--c:${c.color}"></i>${esc(c.name)}</span>`).join('')}</div>`;
  const panel = (title, ico, body) => `<div class="panel"><div class="ph"><span>${title}</span><span class="tl sm">${ico}</span></div>${body}</div>`;
  return `<div class="top"><div class="brand"><div class="logo">${ico('house2')}</div><div>${esc(S.me.family.name)}<small>Family Budget</small></div></div>
    <div class="mpick"><button data-act="mprev" aria-label="เดือนก่อนหน้า">‹</button><span>${THMONTH(S.month)}</span><button data-act="mnext" aria-label="เดือนถัดไป">›</button></div></div>
  ${avatars(null, 'mvopen', '')}
  <div class="card glow total"><div class="lbl">ยอดคงเหลือรวม</div><div class="big">${cur()}${fmt(s.balance)} <span style="font-size:22px;color:${s.balance >= 0 ? 'var(--green)' : 'var(--red)'}">${s.balance >= 0 ? '↑' : '↓'}</span></div></div>
  <div class="sec2"><h2>ภาพรวมการเงิน</h2><div class="muted small">สรุปข้อมูลประจำเดือน ${THMONTH(S.month)}</div></div>
  <div class="g3">
    <div class="gc" style="--c:#2ee59d"><span class="l">รายรับรวม</span><b>${cur()}${fmt(s.income)}</b><i class="arr">↗</i></div>
    <div class="gc" style="--c:#ff4d8d"><span class="l">รายจ่ายรวม</span><b>${cur()}${fmt(s.expense)}</b><i class="arr">↘</i></div>
    <div class="gc" style="--c:#6d5dfc"><span class="l">คงเหลือสุทธิ</span><b style="${net < 0 ? 'color:#ff9db3' : ''}">${cur()}${fmt(net)}</b><i class="arr">👛</i></div>
  </div>
  ${s.debtsSoon?.length ? `<button class="card glow dsoon" style="--c:var(--orange)" data-act="nav" data-v="debts"><div class="row between"><b>⏰ หนี้ใกล้ครบกำหนด</b><span class="muted small">ดูทั้งหมด ›</span></div>${s.debtsSoon.map(x => `<div class="row between small" style="padding:6px 0 0"><span>${esc(x.name)}</span><span style="color:${dueColor(x)}">${cur()}${fmt(x.amount)} · ${dueLabel(x)}</span></div>`).join('')}</button>` : ''}
  ${panel('สัดส่วนรายรับ-รายจ่าย', '⚖️', (s.income + s.expense) > 0 ? `<div class="dbig">${donut([{ amount: s.income, color: '#2ee59d' }, { amount: s.expense, color: '#ff4d6d' }], 'คงเหลือสุทธิ', cur() + fmt(net), net < 0 ? '#ff9db3' : '#7dffc6')}</div>
    <div class="lg2"><div style="--c:#2ee59d"><span><i></i>รายรับ</span><b>${cur()}${fmt(s.income)}</b><em>${fp(s.income, s.income + s.expense)}</em></div><div style="--c:#ff4d6d"><span><i></i>รายจ่าย</span><b>${cur()}${fmt(s.expense)}</b><em>${fp(s.expense, s.income + s.expense)}</em></div></div>` : empty('ยังไม่มีรายการในเดือนนี้'))}
  ${panel('งบประมาณคงเหลือ', '🎯', s.budgets?.length ? s.budgets.map(b => { const p = Math.round(b.spent / b.budget * 100); return `<div class="bb"><div class="row between"><b>${esc(b.icon)} ${esc(b.name)}</b><span class="small"><span style="color:${bcol(p)}">${cur()}${fmt(b.spent)}</span> <span class="muted">/ ${cur()}${fmt(b.budget)}</span></span></div><div class="bar" style="--c:${bcol(p)}"><i style="width:${Math.min(100, p)}%"></i></div></div>`; }).join('') : empty('ยังไม่ได้ตั้งงบรายหมวด<br>ไปที่ “หมวดหมู่” แล้วกด ✎ เพื่อตั้งงบประมาณ'))}
  <div class="sec">รายจ่ายแยกตามสมาชิก</div>
  ${s.members.map(m => `<button class="card glow mrow" style="--c:${m.color}" data-act="mvopen" data-id="${m.id}"><div class="nm"><span><span class="mini">${avHTML(m.avatar)}</span>${esc(m.name)}</span><span>${cur()}${fmt(m.spent)} <span class="muted small">${m.pct}%</span></span></div><div class="bar"><i style="width:${m.pct}%"></i></div></button>`).join('')}
  <div class="sec">รายการล่าสุด</div>
  ${s.recent.length ? s.recent.map(txRow).join('') : empty('ยังไม่มีรายการ — กด ＋ เพื่อเพิ่ม หรือส่งสลิปผ่าน LINE')}`;
};

/* --- add transaction --- */
function addInit(keep) {
  const m0 = S.me.members[0];
  S.add = { memberId: keep?.memberId || m0?.id, type: keep?.type || 'expense', amt: '', main: '', sub: '', date: keep?.date || today(), note: '', slipRef: '', slip: null };
  autoCat();
}
function autoCat() { const a = S.add; const list = mains(a.type); if (!list.find(c => c.id === a.main)) { a.main = (list.find(c => c.name === 'อื่นๆ') || list[0])?.id; a.sub = ''; } }
const amtText = () => { const [i, d] = (S.add.amt || '0').split('.'); return cur() + ' ' + Number(i || 0).toLocaleString('en-US') + (d !== undefined ? '.' + d : ''); };
V.add = async () => {
  if (!S.add) addInit();
  const a = S.add;
  return `${back()}<h2>เพิ่มรายการ</h2></div>
  <button class="scan" data-act="scan"><span class="cam">${ico('camera')}</span><span><b>สแกนสลิป / ใบเสร็จ</b><div class="muted small">ถ่ายรูปหรือเลือกรูป ระบบกรอกให้อัตโนมัติ</div></span></button>
  <input type="file" id="slipFile" accept="image/*" class="hidden">
  ${a.slip ? `<div class="slipinfo">🧾 ข้อมูลจากสลิป (เก็บเฉพาะข้อความ ไม่เก็บไฟล์รูป)<br>${[a.slip.bank && '🏦 ' + esc(a.slip.bank), a.slip.receiver && '👤 ' + esc(a.slip.receiver), a.slip.ref && 'Ref ' + esc(a.slip.ref)].filter(Boolean).join(' · ')}</div>` : ''}
  <div class="sec">ใครเป็นคนบันทึก?</div>${avatars(a.memberId, 'addmember')}
  <div class="seg ${a.type === 'expense' ? 'exp' : 'inc'}"><button class="${a.type === 'expense' ? 'on' : ''}" data-act="addtype" data-t="expense">รายจ่าย</button><button class="${a.type === 'income' ? 'on' : ''}" data-act="addtype" data-t="income">รายรับ</button></div>
  <div class="sec">จำนวนเงิน</div>
  <div class="amount ${a.type === 'expense' ? 'red' : ''} ${a.warn?.amount ? 'warn' : ''}" id="amt">${amtText()}</div>
  <div class="keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => `<button data-act="key" data-k="${k}">${k}</button>`).join('')}</div>
  <label class="f">หมวดหมู่</label>
  <select class="i ${a.warn?.cat ? 'warn' : ''}" id="addMain">${mains(a.type).map(c => `<option value="${c.id}" ${a.main === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select>
  <div class="chips" id="subChips">${subChips()}</div>
  <label class="f">วันที่</label>${dateField('addDate', a.date)}
  <label class="f">บันทึกช่วยจำ</label><textarea class="i" id="addNote" placeholder="เช่น ซื้อของสดที่โลตัส">${esc(a.note)}</textarea>
  <div class="gap"></div><button class="btn" data-act="save" data-again="0">บันทึกรายการ</button>
  <div class="gap"></div><button class="btn ghost" data-act="save" data-again="1">บันทึกและเพิ่มต่อ</button>`;
};
const subChips = () => { const a = S.add; const sl = subs(a.main); return sl.length ? `<button class="chip ${!a.sub ? 'on' : ''}" data-act="subpick" data-id="">ทั่วไป</button>` + sl.map(c => `<button class="chip ${a.sub === c.id ? 'on' : ''}" data-act="subpick" data-id="${c.id}">${esc(c.name)}</button>`).join('') : ''; };
AFTER.add = () => {
  $('#addMain')?.addEventListener('change', e => { if (S.add.warn) S.add.warn.cat = false; e.target.classList.remove('warn'); S.add.main = e.target.value; S.add.sub = ''; $('#subChips').innerHTML = subChips(); });
  $('#addDate')?.addEventListener('change', e => { const iso = parseDMY(e.target.value); if (iso) S.add.date = iso; else toast(BADDATE, 'err'); });
  $('#addNote')?.addEventListener('input', e => S.add.note = e.target.value);
  $('#slipFile')?.addEventListener('change', guard(scanFile));
};

async function downscale(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}
async function scanFile(e) {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  const btn = $('[data-act=scan]'); const old = btn.innerHTML;
  btn.innerHTML = '<span class="cam"><span class="spin"></span></span><span><b>กำลังอ่านสลิป…</b><div class="muted small">รอสักครู่</div></span>';
  try {
    const data = await downscale(f);
    const r = await api('/slip/scan', 'POST', { image: data, mime: 'image/jpeg' });
    if (!r.isSlip || !r.amount) throw new Error('ไม่พบยอดเงินในรูปนี้ ลองถ่ายให้ชัดขึ้น');
    if (r.duplicate) toast('⚠️ สลิปนี้เคยบันทึกแล้ว', 'err');
    const a = S.add;
    a.type = r.type; a.amt = String(r.amount); a.date = r.date || today(); a.note = r.note || '';
    a.slipRef = r.duplicate ? '' : (r.ref || '');
    a.slip = r.duplicate ? null : { bank: r.bank, sender: r.sender, receiver: r.receiver, ref: r.ref, time: r.time, memo: r.memo };
    const c = S.cats.find(x => x.id === r.categoryId);
    if (c) { a.main = c.parentId || c.id; a.sub = c.parentId ? c.id : ''; }
    a.warn = { amount: !!r.amountUncertain, cat: !!r.categoryUncertain };
    autoCat(); await render();
    if (!r.duplicate) {
      const bad = [a.warn.amount && 'จำนวนเงิน', a.warn.cat && 'หมวดหมู่'].filter(Boolean);
      toast(bad.length ? `อ่านได้ ${cur()}${fmt(r.amount)} แต่ไม่แน่ใจ${bad.join('และ')} — ตรวจสอบช่องที่เตือนก่อนบันทึก` : `✓ สแกนสำเร็จ ${cur()}${fmt(r.amount)} — ตรวจสอบแล้วกดบันทึก`, bad.length ? 'err' : 'good');
    }
  } catch (err) { btn.innerHTML = old; toast(err.message, 'err'); }
}
const saveTx = guard(async (again) => {
  const a = S.add; const amt = parseFloat(a.amt);
  const dt = getDate('addDate'); if (!dt) throw new Error(BADDATE); a.date = dt;
  if (!(amt > 0)) throw new Error('กรุณาใส่จำนวนเงิน');
  await api('/transactions', 'POST', { type: a.type, amount: amt, memberId: a.memberId, categoryId: a.sub || a.main, date: a.date, note: a.note, slipRef: a.slipRef || undefined, slip: a.slip || undefined });
  toast('✓ บันทึกแล้ว', 'good');
  if (again) { addInit(a); render(); } else { S.add = null; go('home'); }
});

/* --- categories --- */
V.cats = async () => {
  const list = mains(S.catTab);
  return `<div class="bar-top"><h2 class="grow">จัดการหมวดหมู่</h2></div>
  <div class="seg"><button class="${S.catTab === 'expense' ? 'on' : ''}" data-act="cattab" data-t="expense">หมวดรายจ่าย</button><button class="${S.catTab === 'income' ? 'on' : ''}" data-act="cattab" data-t="income">หมวดรายรับ</button></div><div class="gap"></div>
  ${list.map(c => { const open = S.openCats[c.id]; return `<div class="cat" style="--c:${c.color}">
    <div class="hd">${ci(c.icon, c.color)}<button class="nm" style="text-align:left;color:inherit;font:inherit" data-act="catopen" data-id="${c.id}">${esc(c.name)} <span class="muted small">${c.budget > 0 ? 'งบ ' + cur() + fmt(c.budget) + ' ' : ''}${open ? '▴' : '▾'}</span></button><button class="ib" data-act="catedit" data-id="${c.id}">✎</button><button class="ib" data-act="catdel" data-id="${c.id}">🗑</button></div>
    ${open ? `<div class="subs">${subs(c.id).map(s => `<div class="sub"><span>• ${esc(s.name)}</span><span><button class="ib" data-act="catedit" data-id="${s.id}">✎</button><button class="ib" data-act="catdel" data-id="${s.id}">🗑</button></span></div>`).join('')}<div class="sub"><button class="chip" data-act="catadd" data-parent="${c.id}">＋ เพิ่มหมวดย่อย</button></div></div>` : ''}</div>`; }).join('')}
  <button class="fab" data-act="catadd" data-parent="">＋</button>`;
};
function catForm(c, parent) {
  const isMain = c ? !c.parentId : !parent;
  const sel = { icon: c?.icon || '📁', color: c?.color || '#3d8bff' };
  const o = modal(`<h3>${c ? 'แก้ไข' : 'เพิ่ม'}${isMain ? 'หมวดหมู่หลัก' : 'หมวดย่อย'}</h3>
    <label class="f">ชื่อ</label><input class="i" id="cfName" value="${esc(c?.name || '')}" maxlength="40">
    ${isMain ? `<label class="f">ไอคอน</label><div class="emojis" id="cfIcons">${CAT_ICONS.map(e => `<button type="button" data-e="${e}" class="${sel.icon === e ? 'on' : ''}">${ci(e, sel.color)}</button>`).join('')}</div>
    <label class="f">สี</label><div class="sw-colors" id="cfColors">${['#ff8a3d', '#3d8bff', '#a66bff', '#f5d000', '#ff4d6d', '#2ee59d', '#2ec5ff', '#ff7ac8'].map(x => `<button style="--c:${x}" data-c="${x}" class="${sel.color === x ? 'on' : ''}"></button>`).join('')}</div>` : ''}
    ${isMain && (c ? c.type : S.catTab) === 'expense' ? `<label class="f">งบประมาณรายเดือน (${cur()}) — ไม่บังคับ</label><input class="i" id="cfBudget" type="number" min="0" inputmode="decimal" value="${c?.budget || ''}" placeholder="แสดงในกราฟงบประมาณคงเหลือ">` : ''}
    <div class="gap"></div><button class="btn" id="cfSave">บันทึก</button>`);
  o.addEventListener('click', e => {
    const b = e.target.closest('[data-e],[data-c]'); if (!b) return;
    if (b.dataset.e) { sel.icon = b.dataset.e; $('#cfIcons').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }
    if (b.dataset.c) { sel.color = b.dataset.c; $('#cfColors').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }
  });
  $('#cfSave').onclick = guard(async () => {
    const name = $('#cfName').value.trim(); if (!name) throw new Error('กรุณาใส่ชื่อ');
    const budget = $('#cfBudget') ? Number($('#cfBudget').value) || 0 : undefined;
    if (c) await api('/categories/' + c.id, 'PUT', { name, ...(isMain ? { ...sel, budget } : {}) });
    else await api('/categories', 'POST', { name, type: S.catTab, parentId: parent || undefined, ...(isMain ? { ...sel, budget } : {}) });
    await refreshCats(); if (parent) S.openCats[parent] = true; closeModal(); render();
  });
}

/* --- member detail --- */
V.member = async () => {
  const id = S.mv.id; const q = `?range=${S.mv.range}` + (S.mv.range === 'custom' ? `&from=${S.mv.from}&to=${S.mv.to}` : '');
  const d = await api(`/members/${id}/stats${q}`);
  const col = d.pct >= 100 ? 'var(--red)' : d.pct >= 80 ? 'var(--orange)' : 'var(--green)';
  const R = 42, C = 2 * Math.PI * R, p = Math.min(100, d.pct);
  const tabs = [['today', 'วันนี้'], ['week', 'สัปดาห์นี้'], ['month', 'เดือนนี้'], ['custom', 'กำหนดเอง']];
  return `${back()}<div class="av sm" style="--c:${d.member.color};flex-direction:row;gap:10px"><i>${avHTML(d.member.avatar)}</i></div><h2 class="grow">รายจ่ายของ${esc(d.member.name)}</h2></div>
  <div class="card glow" style="--c:${d.member.color}">
    <div class="ring">
      <div class="grow k"><span class="muted small">งบประจำเดือน</span><b>${d.budget ? cur() + fmt(d.budget) : 'ยังไม่ได้ตั้งงบ'}</b><span>ใช้ไป <b class="redc" style="font-size:15px">${cur()}${fmt(d.spentMonth)}</b></span>${d.budget ? `<span>คงเหลือ <b style="font-size:15px;color:${d.remaining < 0 ? 'var(--red)' : 'var(--green)'}">${cur()}${fmt(d.remaining)}</b></span>` : ''}<button class="btn ghost sm" data-act="setbudget" data-id="${id}" style="margin-top:4px">ตั้งงบ</button></div>
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" fill="none" stroke="#1d2533" stroke-width="10"/><circle cx="50" cy="50" r="${R}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C * p / 100} ${C}" transform="rotate(-90 50 50)" style="filter:drop-shadow(0 0 4px ${col})"/><text x="50" y="52" text-anchor="middle" fill="#eef2f8" font-size="17" font-weight="700">${d.budget ? d.pct + '%' : '—'}</text><text x="50" y="65" text-anchor="middle" fill="#8a95a8" font-size="7">ใช้ไปแล้ว</text></svg>
    </div></div>
  <div class="gap"></div><div class="seg">${tabs.map(([k, l]) => `<button class="${S.mv.range === k ? 'on' : ''}" data-act="mvrange" data-r="${k}">${l}</button>`).join('')}</div>
  ${S.mv.range === 'custom' ? `<div class="two">${dateField('mvFrom', S.mv.from)}${dateField('mvTo', S.mv.to)}</div>` : ''}
  <div class="row between sec"><span>รายจ่ายตามหมวด</span><span class="muted small">รวม ${cur()}${fmt(d.totals.expense)}</span></div>
  ${d.categories.length ? d.categories.map(c => `<div class="cbar" style="--c:${c.color}"><div class="lbl"><span>${esc(c.icon)} ${esc(c.name)}</span><span>${cur()}${fmt(c.amount)} <span class="muted">(${Math.round(c.pct)}%)</span></span></div><div class="pillbar"><i style="width:${Math.max(4, c.pct)}%"></i></div></div>`).join('') : empty('ไม่มีรายจ่ายในช่วงนี้')}
  <div class="sec">รายการล่าสุด</div>${d.recent.length ? d.recent.map(txRow).join('') : empty('ยังไม่มีรายการ')}`;
};
AFTER.member = () => { for (const k of ['From', 'To']) $('#mv' + k)?.addEventListener('change', e => { const iso = parseDMY(e.target.value); if (!iso) return toast(BADDATE, 'err'); S.mv[k.toLowerCase()] = iso; render(); }); };

/* --- reports --- */
V.reports = async () => {
  const r = S.rp; const q = `?range=${r.range}&member=${r.member}` + (r.range === 'custom' ? `&from=${r.from}&to=${r.to}` : '');
  const d = S.rpData = await api('/report' + q);
  const max = Math.max(1, ...d.series.flatMap(s => [s.income, s.expense]));
  const W = Math.max(300, d.series.length * 34), H = 130;
  const bars = d.series.map((s, i) => { const x = 12 + i * 34, hi = s.income / max * 100, he = s.expense / max * 100;
    return `<rect x="${x}" y="${H - 18 - hi}" width="12" height="${hi}" rx="3" fill="#2ee59d"/><rect x="${x + 14}" y="${H - 18 - he}" width="12" height="${he}" rx="3" fill="#ff4d6d"/><text x="${x + 13}" y="${H - 4}" fill="#8a95a8" font-size="8.5" text-anchor="middle">${s.date.slice(8)}</text>`; }).join('');
  return `<div class="bar-top"><h2 class="grow">รายงาน</h2></div>
  <div class="seg">${[['today', 'วันนี้'], ['week', 'สัปดาห์'], ['month', 'เดือน'], ['custom', 'กำหนดเอง']].map(([k, l]) => `<button class="${r.range === k ? 'on' : ''}" data-act="rprange" data-r="${k}">${l}</button>`).join('')}</div>
  ${r.range === 'custom' ? `<div class="two">${dateField('rpFrom', r.from)}${dateField('rpTo', r.to)}</div>` : ''}
  <div class="chips"><button class="chip ${!r.member ? 'on' : ''}" data-act="rpmember" data-id="">ทุกคน</button>${S.me.members.map(m => `<button class="chip ${r.member === m.id ? 'on' : ''}" data-act="rpmember" data-id="${m.id}">${emoji(m.avatar)} ${esc(m.name)}</button>`).join('')}</div>
  <div class="two"><div class="card glow inc stat"><div><span class="muted small">รายรับ</span><b>${cur()}${fmt(d.totals.income)}</b></div></div><div class="card glow exp stat"><div><span class="muted small">รายจ่าย</span><b>${cur()}${fmt(d.totals.expense)}</b></div></div></div>
  <div class="sec">กราฟรายวัน <span class="muted small">(<span class="green">■</span> รับ <span class="redc">■</span> จ่าย)</span></div>
  <div class="card chart">${d.series.length ? `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bars}</svg>` : empty('ไม่มีข้อมูลในช่วงนี้')}</div>
  <div class="sec">รายจ่ายตามหมวด</div>
  <div class="card">${d.categories.length ? `<div class="donut">${donut(d.categories, 'รวม', cur() + fmt(d.totals.expense))}<div class="legend">${d.categories.slice(0, 7).map(c => `<div><span><i class="dot" style="--c:${c.color}"></i>${esc(c.name)}</span><span class="muted">${fmt(c.amount)}</span></div>`).join('')}</div></div>` : empty('—')}</div>
  <div class="sec">ส่งออก</div>
  <div class="two" style="margin-top:0"><button class="btn" data-act="exppdf">📄 ส่งออก PDF</button><button class="btn ghost" data-act="expcsv">⬇️ CSV (Excel)</button></div>`;
};
AFTER.reports = () => { for (const k of ['From', 'To']) $('#rp' + k)?.addEventListener('change', e => { const iso = parseDMY(e.target.value); if (!iso) return toast(BADDATE, 'err'); S.rp[k.toLowerCase()] = iso; render(); }); };
function exportCSV() {
  const d = S.rpData; const rows = [['วันที่', 'ประเภท', 'สมาชิก', 'หมวดหมู่หลัก', 'หมวดย่อย', 'จำนวน', 'บันทึก']];
  d.transactions.forEach(t => rows.push([dmy(t.date), t.type === 'income' ? 'รายรับ' : 'รายจ่าย', t.memberName, t.mainCategoryName, t.categoryName, t.amount, t.note || '']));
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `family-budget_${d.from}_${d.to}.csv`; a.click();
}
function exportPDF() {
  const d = S.rpData; const w = window.open('', '_blank'); if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต pop-up แล้วลองอีกครั้ง', 'err');
  const c = cur();
  w.document.write(`<!doctype html><html lang="th"><meta charset="utf-8"><title>รายงาน ${dmy(d.from)} – ${dmy(d.to)}</title><style>
  body{font-family:"Noto Sans Thai","Sarabun",sans-serif;color:#111;margin:28px}h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:10px 0 22px;font-size:13px}
  th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}th{background:#f2f4f7}td.r,th.r{text-align:right}.g{color:#0a8f5b}.rd{color:#d12a4b}.box{display:flex;gap:12px}.box div{flex:1;border:1px solid #ddd;border-radius:10px;padding:10px}
  </style><h1>${esc(S.me.family.name)} — รายงานรายรับรายจ่าย</h1><div>${dmy(d.from)} ถึง ${dmy(d.to)}${S.rp.member ? ' · ' + esc(member(S.rp.member)?.name || '') : ' · ทุกคน'}</div><br>
  <div class="box"><div>รายรับ<br><b class="g">${c}${fmt(d.totals.income)}</b></div><div>รายจ่าย<br><b class="rd">${c}${fmt(d.totals.expense)}</b></div><div>คงเหลือ<br><b>${c}${fmt(d.totals.net)}</b></div></div>
  <h3>รายจ่ายตามหมวด</h3><table><tr><th>หมวด</th><th class="r">จำนวน</th><th class="r">%</th></tr>${d.categories.map(x => `<tr><td>${esc(x.icon)} ${esc(x.name)}</td><td class="r">${fmt(x.amount)}</td><td class="r">${x.pct}%</td></tr>`).join('')}</table>
  <h3>รายการทั้งหมด (${d.transactions.length})</h3><table><tr><th>วันที่</th><th>สมาชิก</th><th>หมวด</th><th>บันทึก</th><th class="r">จำนวน</th></tr>${d.transactions.map(t => `<tr><td>${dmy(t.date)}</td><td>${esc(t.memberName)}</td><td>${esc(t.categoryName)}</td><td>${esc(t.note || '')}</td><td class="r ${t.type === 'income' ? 'g' : 'rd'}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</td></tr>`).join('')}</table>
  <script>onload=()=>setTimeout(()=>print(),300)<\/script></html>`);
  w.document.close();
}

/* --- settings --- */
V.settings = async () => {
  const f = S.me.family, L = f.line, n = f.notify;
  const tog = (k, l, sub) => `<div class="tog"><div>${l}<div class="muted small">${sub}</div></div><button class="sw ${n[k] ? 'on' : ''}" data-act="notif" data-k="${k}"></button></div>`;
  return `<div class="bar-top"><h2 class="grow">ตั้งค่า</h2></div>
  <div class="card set">${sh('users','ครอบครัว')}
    <label class="f" style="margin-top:0">ชื่อครอบครัว</label><input class="i" id="stName" value="${esc(f.name)}">
    <label class="f">สกุลเงิน</label><select class="i" id="stCur">${['฿', '$', '€', '£', '¥', '₹'].map(c => `<option ${f.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <div class="gap"></div><button class="btn ghost sm" data-act="stsave">บันทึก</button></div>
  <div class="card set">${sh('users','สมาชิกและงบประมาณ','','blue')}
    ${S.me.members.map(m => `<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><span class="mini" style="width:36px;height:36px">${avHTML(m.avatar)}</span><div class="grow"><b>${esc(m.name)}</b><div class="muted small">งบ ${m.budget ? cur() + fmt(m.budget) : '—'} · ${m.linked ? '<span class="green">เชื่อม LINE แล้ว</span>' : 'ยังไม่เชื่อม LINE'}</div></div><button class="ib" data-act="memedit" data-id="${m.id}">✎</button><button class="ib" data-act="memdel" data-id="${m.id}">🗑</button></div>`).join('')}
    <div class="gap"></div><button class="btn ghost sm" data-act="memadd">＋ เพิ่มสมาชิก</button></div>
  <div class="card set">${sh('bell','การแจ้งเตือน (ผ่าน LINE)','','orange')}
    ${tog('onAdd', 'แจ้งเมื่อมีรายการใหม่', 'ส่งถึงสมาชิกคนอื่นที่เชื่อม LINE')}${tog('budget', 'เตือนใกล้เกินงบ', 'เมื่อใช้ถึง 80% และ 100% ของงบรายเดือน')}${tog('daily', 'สรุปรายวัน 20:00 น.', 'ยอดรับ-จ่ายของวันนี้')}</div>
  ${window.LOCAL ? `<div class="card set">${sh('chat','LINE Official Account','','green')}<div class="muted small" style="line-height:1.7">ไฟล์ HTML นี้เก็บข้อมูลไว้ในเครื่อง จึงเชื่อม LINE ไม่ได้ — การรับข้อความจาก LINE ต้องมีเซิร์ฟเวอร์ ใช้เวอร์ชันเซิร์ฟเวอร์ (server.js) แล้วกู้คืนไฟล์สำรองจากหน้านี้ได้</div></div>` : `<div class="card set">${sh('chat','LINE Official Account',`<span class="badge ${L.configured ? 'ok' : 'no'}">${L.configured ? 'เชื่อมต่อแล้ว' : 'ยังไม่ตั้งค่า'}</span>`)}
    <ol class="steps"><li>สร้าง LINE OA และเปิด <b>Messaging API</b> ที่ developers.line.biz</li><li>คัดลอก <b>Channel secret</b> และ <b>Channel access token (long-lived)</b> มาใส่ด้านล่าง</li><li>ตั้ง <b>Webhook URL</b> เป็นค่าด้านล่าง → เปิด <b>Use webhook</b> และปิด Auto-reply</li><li>กด “สร้างรหัส” ของสมาชิกแต่ละคน → ให้สมาชิก<b>สแกน QR</b> ด้วย LINE แล้วกดส่งข้อความ “ผูก ……” ที่ขึ้นรอในแชท OA</li></ol>
    <div class="muted small">Webhook URL</div><code class="url" id="whUrl">${esc(L.webhookUrl)}</code>
    ${L.webhookUrl.startsWith('http://') ? '<div class="muted small" style="color:var(--orange)">⚠️ LINE ต้องใช้ HTTPS — ใช้โดเมนจริงหรือ tunnel (ngrok / Cloudflare Tunnel) แล้วตั้งค่า PUBLIC_URL</div>' : ''}
    <button class="btn ghost sm" data-act="copywh" style="margin:6px 0">คัดลอก URL</button>
    <label class="f">Channel secret ${L.hasSecret ? '<span class="green">(บันทึกแล้ว)</span>' : ''}</label><input class="i" id="lnSecret" type="password" placeholder="${L.hasSecret ? '•••••• (เว้นว่าง = ไม่เปลี่ยน)' : 'วาง Channel secret'}" autocomplete="off">
    <label class="f">Channel access token ${L.hasToken ? '<span class="green">(บันทึกแล้ว)</span>' : ''}</label><input class="i" id="lnToken" type="password" placeholder="${L.hasToken ? '•••••• (เว้นว่าง = ไม่เปลี่ยน)' : 'วาง Channel access token'}" autocomplete="off">
    <label class="f">LINE ID ของ OA (ใช้สร้าง QR) ${L.basicId ? '<span class="green">(' + esc('@' + L.basicId) + ')</span>' : ''}</label><input class="i" id="lnBasic" value="${esc(L.basicId || '')}" placeholder="เช่น @123abcde — เว้นว่างเพื่อดึงอัตโนมัติจาก Token" autocomplete="off">
    <div class="gap"></div><div class="row"><button class="btn sm" data-act="lnsave">บันทึก</button><button class="btn ghost sm" data-act="lntest">ส่งข้อความทดสอบ</button></div>
    <div class="sec subsec">${ico('scan')}รหัสผูกบัญชี LINE</div>
    ${S.me.members.map(m => `<div class="row" style="padding:6px 0"><span><span class="mini" style="width:24px;height:24px">${avHTML(m.avatar)}</span> ${esc(m.name)}</span><span class="grow"></span>${S.me.user.admin ? `<button class="chip" data-act="accesscode" data-id="${m.id}">🔑 รหัสเข้าใช้งาน</button>` : ''}${m.linked ? `<button class="chip" data-act="unlink" data-id="${m.id}">ยกเลิกการเชื่อม</button>` : `<button class="chip" data-act="linkcode" data-id="${m.id}">สร้างรหัส</button>`}</div>`).join('')}
    <div class="gap"></div><div class="row" style="flex-wrap:wrap;gap:6px"><span class="badge ${L.ocr ? 'ok' : 'no'}">${L.ocr ? 'สแกนสลิป/บิลพร้อมใช้' : 'สแกนสลิปยังปิดอยู่'}</span>${(L.ocrProviders || []).map((p, i) => `<span class="badge ok" title="${esc(p.model)}">${i ? 'สำรอง · ' : 'หลัก · '}${esc(p.label)}</span>`).join('')}</div>
    ${L.ocr ? '<div class="muted small" style="margin-top:6px">อ่านได้ทั้งสลิปโอนเงินและบิลเงินสด/ใบเสร็จ — ถ้าตัวแรกอ่านไม่ได้จะลองตัวถัดไปให้อัตโนมัติ</div>' : '<div class="muted small" style="margin-top:6px;line-height:1.6">ใส่กุญแจอย่างน้อย 1 ตัวในไฟล์ <b>.env</b> บนเซิร์ฟเวอร์: <b>ANTHROPIC_API_KEY</b> (Claude) · <b>GEMINI_API_KEY</b> (Gemini) · <b>OPENAI_API_KEY</b> (GPT) แล้วเปิดแอปใหม่</div>'}
    <div class="sec subsec">${ico('chat')}คำสั่งใน LINE</div>
    <div class="muted small" style="line-height:1.8">จ่าย 120 ข้าวมันไก่ · รับ 5000 เงินเดือน · กาแฟ 65<br>ส่งรูปสลิป → บันทึกอัตโนมัติ · สรุป · วันนี้ · ลบล่าสุด</div></div>`}
  ${window.LOCAL ? '' : `<div class="card set">${sh('download','ติดตั้งเป็นแอป','','blue')}${installBlock()}</div>`}
  <div class="card set">${sh('cloud','สำรองข้อมูล','','blue')}<div class="row"><button class="btn ghost sm" data-act="backup">☁️ ดาวน์โหลดไฟล์สำรอง</button><button class="btn ghost sm" data-act="restore">กู้คืน</button></div><input type="file" id="restoreFile" accept="application/json" class="hidden"></div>
  ${window.LOCAL ? '<div class="muted small center">ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้ — แนะนำให้สำรองข้อมูลเป็นระยะ</div>' : `<div class="card set"><div class="muted small">เข้าสู่ระบบเป็น ${esc(S.me.user.name)}${S.me.user.phone ? ' · ' + esc(S.me.user.phone) : ''}${S.me.user.admin ? ' · ผู้ดูแล' : ''}</div><div class="gap"></div><button class="btn danger" data-act="logout">ออกจากระบบ</button></div>`}`;
};
AFTER.settings = () => {
  $('#restoreFile')?.addEventListener('change', guard(async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('การกู้คืนจะแทนที่สมาชิก หมวดหมู่ และรายการทั้งหมดปัจจุบัน ดำเนินการต่อหรือไม่?')) return;
    const r = await api('/restore', 'POST', JSON.parse(await f.text())); await refreshMe(); await refreshCats(); toast(`กู้คืนแล้ว ${r.transactions} รายการ`, 'good'); render();
  }));
};
async function cropSquare(file, size = 192) {
  const bmp = await createImageBitmap(file); const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.82);
}
function memberForm(m) {
  const st = { avatar: m?.avatar || EMOJIS[S.me.members.length % EMOJIS.length], color: m?.color || COLORS[S.me.members.length % COLORS.length] };
  const lastEmoji = isImg(st.avatar) ? '🙂' : st.avatar;
  const o = modal(`<h3>${m ? 'แก้ไข' : 'เพิ่ม'}สมาชิก</h3><label class="f">ชื่อ</label><input class="i" id="mfName" value="${esc(m?.name || '')}" maxlength="30">
    <label class="f">รูปสมาชิก</label>
    <div class="row"><div class="av" id="mfPrev" style="--c:${st.color}"><i>${avHTML(st.avatar)}</i></div><div class="grow"><button class="btn ghost sm" id="mfUp" type="button">📷 อัปโหลดรูป</button> <button class="btn ghost sm" id="mfClr" type="button">ใช้อีโมจิ</button></div></div>
    <input type="file" id="mfFile" accept="image/*" class="hidden">
    <div class="emojis" id="mfAv">${EMOJIS.map(e => `<button type="button" data-e="${e}" class="${st.avatar === e ? 'on' : ''}"><span class="tl rd" style="--c:${st.color}">${avHTML(e)}</span></button>`).join('')}</div>
    <label class="f">สี</label><div class="sw-colors" id="mfCol">${COLORS.map(x => `<button type="button" style="--c:${x}" data-c="${x}" class="${st.color === x ? 'on' : ''}"></button>`).join('')}</div>
    <label class="f">งบประจำเดือน (${cur()}) — ไม่บังคับ</label><input class="i" id="mfBudget" type="number" min="0" inputmode="decimal" value="${m?.budget || ''}">
    <div class="gap"></div><button class="btn" id="mfSave">บันทึก</button>`);
  const prev = () => { const p = $('#mfPrev'); p.style.setProperty('--c', st.color); p.firstChild.innerHTML = avHTML(st.avatar); $('#mfAv').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.e === st.avatar)); };
  o.addEventListener('click', e => {
    const b = e.target.closest('[data-e],[data-c]'); if (!b) return;
    if (b.dataset.e) st.avatar = b.dataset.e;
    if (b.dataset.c) { st.color = b.dataset.c; $('#mfCol').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }
    prev();
  });
  $('#mfUp').onclick = () => $('#mfFile').click();
  $('#mfClr').onclick = () => { st.avatar = lastEmoji; prev(); };
  $('#mfFile').onchange = guard(async (e) => { const f = e.target.files[0]; if (!f) return; st.avatar = await cropSquare(f); prev(); });
  $('#mfSave').onclick = guard(async () => {
    const body = { name: $('#mfName').value, ...st, budget: Number($('#mfBudget').value) || 0 };
    if (m) await api('/members/' + m.id, 'PUT', body); else await api('/members', 'POST', body);
    await refreshMe(); closeModal(); render();
  });
}
function txModal(id) {
  api('/transactions?limit=1000').then(list => {
    const t = list.find(x => x.id === id); if (!t) return;
    const o = modal(`<h3>${esc(t.note || t.categoryName)}</h3><div class="muted">${esc(t.categoryName)} · ${esc(t.memberName)} · ${dmy(t.date)}${t.source !== 'app' ? ' · ' + ({ slip: '🧾 จากสลิป', line: '💬 จาก LINE', debt: '💳 ชำระหนี้' }[t.source] || '') : ''}</div>${t.slip ? `<div class="slipinfo">🧾 ข้อมูลที่อ่านจากสลิป<br>${[t.slip.bank && '🏦 ' + esc(t.slip.bank), t.slip.sender && 'ผู้โอน: ' + esc(t.slip.sender), t.slip.receiver && 'ผู้รับ: ' + esc(t.slip.receiver), t.slip.time && '🕘 ' + esc(t.slip.time), t.slip.ref && 'Ref: ' + esc(t.slip.ref)].filter(Boolean).join('<br>')}</div>` : ''}
      <div style="font-size:30px;font-weight:700;margin:10px 0" class="${t.type === 'income' ? 'green' : 'redc'}">${t.type === 'income' ? '+' : '-'}${cur()}${fmt(t.amount)}</div>
      <div class="two"><button class="btn ghost" id="txEdit">แก้ไขจำนวน</button><button class="btn danger" id="txDel">ลบรายการ</button></div>`);
    $('#txDel').onclick = guard(async () => { if (!confirm('ลบรายการนี้?')) return; await api('/transactions/' + id, 'DELETE'); closeModal(); toast('ลบแล้ว'); render(); });
    $('#txEdit').onclick = guard(async () => { const v = prompt('จำนวนเงินใหม่', t.amount); if (v === null) return; await api('/transactions/' + id, 'PUT', { amount: v }); closeModal(); toast('แก้ไขแล้ว', 'good'); render(); });
  });
}

/* ---------- actions (event delegation) ---------- */
const A = {
  nav: (el) => { const v = el.dataset.v; if (v === 'add' && !S.add) addInit(); go(v); },
  authtab: (el) => go('auth', { authTab: el.dataset.t }),
  logout: () => confirm('ออกจากระบบ?') && logout(),
  // setup
  sfavatar: (el) => { const i = +el.dataset.i; const m = S.setup.members[i]; m.avatar = EMOJIS[(EMOJIS.indexOf(m.avatar) + 1) % EMOJIS.length]; syncSetup(); render(); },
  sfdel: (el) => { syncSetup(); S.setup.members.splice(+el.dataset.i, 1); render(); },
  sfadd: () => { syncSetup(); S.setup.members.push({ name: '', avatar: EMOJIS[S.setup.members.length % EMOJIS.length] }); render(); },
  sfdone: guard(async () => {
    syncSetup(); const st = S.setup; const ms = st.members.filter(m => m.name.trim());
    if (!ms.length) throw new Error('เพิ่มสมาชิกอย่างน้อย 1 คน');
    await api('/family', 'POST', { name: st.name.trim() || 'ครอบครัวของเรา', currency: st.currency, members: ms });
    await refreshMe(); await refreshCats(); S.setup = null; go('home');
  }),
  // home
  mvopen: (el) => { if (!el.dataset.id) return; go('member', { mv: { ...S.mv, id: el.dataset.id, range: 'month' } }); },
  mvrange: (el) => { S.mv.range = el.dataset.r; render(); },
  setbudget: (el) => memberForm(member(el.dataset.id)),
  txopen: (el) => txModal(el.dataset.id),
  // add
  addmember: (el) => { S.add.memberId = el.dataset.id; document.querySelectorAll('.av').forEach(b => b.classList.toggle('sel', b.dataset.id === el.dataset.id)); },
  addtype: (el) => { S.add.type = el.dataset.t; S.add.main = ''; S.add.sub = ''; autoCat(); render(); },
  key: (el) => { const k = el.dataset.k, a = S.add; let v = a.amt;
    if (k === '⌫') v = v.slice(0, -1);
    else if (k === '.') { if (!v.includes('.')) v = (v || '0') + '.'; }
    else { if (v.includes('.') && v.split('.')[1].length >= 2) return; if (v.replace('.', '').length >= 10) return; v = v === '0' ? k : v + k; }
    a.amt = v; if (a.warn) a.warn.amount = false; $('#amt').classList.remove('warn'); $('#amt').textContent = amtText(); },
  subpick: (el) => { S.add.sub = el.dataset.id; $('#subChips').innerHTML = subChips(); },
  scan: () => $('#slipFile').click(),
  save: (el) => saveTx(el.dataset.again === '1'),
  // categories
  cattab: (el) => go('cats', { catTab: el.dataset.t }),
  catopen: (el) => { S.openCats[el.dataset.id] = !S.openCats[el.dataset.id]; render(); },
  catadd: (el) => catForm(null, el.dataset.parent),
  catedit: (el) => catForm(S.cats.find(c => c.id === el.dataset.id)),
  catdel: guard(async (el) => {
    const c = S.cats.find(x => x.id === el.dataset.id); if (!confirm(`ลบ “${c.name}”${c.parentId ? '' : ' และหมวดย่อยทั้งหมด'}?`)) return;
    try { await api('/categories/' + c.id, 'DELETE'); } catch (e) { if (!/ลบรายการเหล่านั้น/.test(e.message) || !confirm(e.message)) throw e; await api('/categories/' + c.id + '?force=1', 'DELETE'); }
    await refreshCats(); render();
  }),
  // reports
  rprange: (el) => { S.rp.range = el.dataset.r; render(); },
  rpmember: (el) => { S.rp.member = el.dataset.id; render(); },
  expcsv: exportCSV, exppdf: exportPDF,
  // settings
  stsave: guard(async () => { await api('/family', 'PUT', { name: $('#stName').value, currency: $('#stCur').value }); await refreshMe(); toast('บันทึกแล้ว', 'good'); render(); }),
  notif: guard(async (el) => { const k = el.dataset.k; await api('/family', 'PUT', { notify: { [k]: !S.me.family.notify[k] } }); await refreshMe(); render(); }),
  memadd: () => memberForm(null), memedit: (el) => memberForm(member(el.dataset.id)),
  memdel: guard(async (el) => {
    const m = member(el.dataset.id); if (!confirm(`ลบสมาชิก “${m.name}”?`)) return;
    try { await api('/members/' + m.id, 'DELETE'); } catch (e) { if (!/ลบพร้อมรายการ/.test(e.message) || !confirm(e.message)) throw e; await api('/members/' + m.id + '?force=1', 'DELETE'); }
    await refreshMe(); S.add = null; render();
  }),
  copywh: () => navigator.clipboard?.writeText($('#whUrl').textContent).then(() => toast('คัดลอกแล้ว', 'good')),
  lnsave: guard(async () => { await api('/family', 'PUT', { line: { channelSecret: $('#lnSecret').value, accessToken: $('#lnToken').value, basicId: $('#lnBasic').value } }); await refreshMe(); toast('บันทึกการเชื่อมต่อ LINE แล้ว', 'good'); render(); }),
  lntest: guard(async () => { const r = await api('/line/test', 'POST'); toast(`ส่งทดสอบถึง ${r.sent} คนแล้ว`, 'good'); }),
  linkcode: guard(async (el) => { const r = await api(`/members/${el.dataset.id}/linkcode`, 'POST'); const m = member(el.dataset.id);
    let qr = '';
    if (r.url && window.QR) { try { qr = `<div class="qrbox">${window.QR.svg(r.url)}</div><p class="muted small" style="text-align:center">เปิดกล้อง LINE → สแกน QR → ข้อความ “ผูก ${r.code}” จะขึ้นในแชท OA → กดส่ง</p><a class="btn ghost sm" href="${esc(r.url)}" target="_blank" rel="noopener" style="display:block;text-align:center;margin:6px 0">เปิดใน LINE (บนมือถือเครื่องนี้)</a>`; } catch (e) { qr = ''; } }
    if (!qr) qr = `<p class="muted small">ยังไม่มี LINE ID ของ OA จึงสร้าง QR ไม่ได้ — ใส่ LINE ID (หรือบันทึก Channel access token) ในหน้าตั้งค่า หรือส่งข้อความด้านล่างไปที่ OA เอง</p>`;
    modal(`<h3>ผูกบัญชี LINE ของ ${esc(m.name)}</h3>${qr}<p class="muted small" style="text-align:center">หรือพิมพ์ส่งเอง (ใช้ได้ ${r.expiresInMinutes} นาที)</p><div class="amount" style="font-size:26px;text-align:center">ผูก ${r.code}</div>${r.addUrl ? `<p class="muted small" style="text-align:center">ยังไม่ได้เพิ่มเพื่อน OA? <a href="${esc(r.addUrl)}" target="_blank" rel="noopener">เพิ่มเพื่อน</a></p>` : ''}<div class="gap"></div><button class="btn" data-act="closem">เข้าใจแล้ว</button>`); }),
  accesscode: guard(async (el) => { const r = await api(`/members/${el.dataset.id}/accesscode`, 'POST');
    modal(`<h3>รหัสเข้าใช้งานของ ${esc(r.name)}</h3><p class="muted small">ให้สมาชิกเปิดแอปแล้วเลือกแท็บ “รหัสจากผู้ดูแล” กรอกรหัสนี้ — ใช้ได้ครั้งเดียว ภายใน ${r.expiresInHours} ชั่วโมง (ออกรหัสใหม่ รหัสเก่าจะใช้ไม่ได้)</p><div class="amount" style="font-size:34px;text-align:center;letter-spacing:4px" id="acCode">${esc(r.code)}</div><div class="gap"></div><button class="btn ghost" data-act="copyac">คัดลอกรหัส</button><div class="gap"></div><button class="btn" data-act="closem">เสร็จสิ้น</button>`); }),
  copyac: () => { navigator.clipboard?.writeText($('#acCode').textContent).then(() => toast('คัดลอกแล้ว', 'good')).catch(() => toast('คัดลอกไม่สำเร็จ', 'err')); },
  install: guard(async () => { const e = S.installEv; if (!e) return; e.prompt(); await e.userChoice; S.installEv = null; render(); }),
  closem: closeModal,
  unlink: guard(async (el) => { if (!confirm('ยกเลิกการเชื่อม LINE ของสมาชิกนี้?')) return; await api('/members/' + el.dataset.id, 'PUT', { unlinkLine: true }); await refreshMe(); render(); }),
  backup: guard(async () => { if (window.LOCAL) { const j = await api('/backup'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' })); a.download = `family-budget-${today()}.json`; a.click(); return; } const r = await fetch('/api/backup', { headers: { Authorization: 'Bearer ' + S.token } }); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `family-budget-${today()}.json`; a.click(); }),
  restore: () => $('#restoreFile').click(),
};
/* --- debts (หนี้สิน) --- */
const debtAmt = (x) => Math.min(x.installment || x.remaining, x.remaining) || x.remaining;
function debtCard(x) {
  const closed = x.status === 'closed'; const c = closed ? 'var(--green)' : dueColor(x);
  return `<div class="card glow debt ${closed ? 'dim' : ''}" style="--c:${c}">
    <div class="row between"><b>${esc(x.name)}</b><span class="badge" style="color:${c}">${closed ? 'ปิดหนี้แล้ว ✓' : dueLabel(x)}</span></div>
    <div class="muted small">${[x.creditor && esc(x.creditor), x.memberName && '👤 ' + esc(x.memberName)].filter(Boolean).join(' · ') || '&nbsp;'}</div>
    <div class="bar" style="--c:var(--green)"><i style="width:${x.paidPct}%"></i></div>
    <div class="row between small muted"><span>จ่ายแล้ว ${x.paidPct}%</span><span>คงเหลือ ${cur()}${fmt(x.remaining)} / ${cur()}${fmt(x.principal)}</span></div>
    ${closed ? '' : `<div class="row between" style="margin-top:8px"><span>ค่างวด <b>${cur()}${fmt(debtAmt(x))}</b>${x.kind === 'monthly' ? ' /เดือน' : ''}</span><span class="muted small">📅 ${dmy(x.dueDate)}${x.installmentsLeft ? ` · เหลือ ${x.installmentsLeft} งวด` : ''}</span></div>`}
    <div class="row" style="margin-top:10px;gap:8px">${closed ? '<span class="grow"></span>' : `<button class="btn sm grow" data-act="debtpay" data-id="${x.id}">💸 จ่ายงวดนี้</button><button class="btn ghost sm" data-act="debtcal" data-id="${x.id}">📅 ปฏิทิน</button>`}<button class="ib" data-act="debtedit" data-id="${x.id}">✎</button><button class="ib" data-act="debtdel" data-id="${x.id}">🗑</button></div></div>`;
}
V.debts = async () => {
  const r = S.debts = await api('/debts'); const s = r.summary;
  const feed = r.feed ? r.feed.replace(/^https?:/, 'webcal:') : '';
  return `<div class="bar-top"><h2 class="grow">หนี้สิน</h2></div>
  <div class="g3">
    <div class="gc" style="--c:#a66bff"><span class="l">หนี้คงเหลือรวม</span><b>${cur()}${fmt(s.totalRemaining)}</b><i class="arr">💳</i></div>
    <div class="gc" style="--c:#ff8a3d"><span class="l">ค่างวด/เดือน</span><b>${cur()}${fmt(s.monthlyDue)}</b><i class="arr">📅</i></div>
    <div class="gc" style="--c:#ff4d6d"><span class="l">เกินกำหนด / ใกล้ถึง</span><b>${s.overdue} / ${s.dueSoon}</b><i class="arr">⏰</i></div>
  </div>
  <div class="row" style="margin:14px 0"><button class="btn sm grow" data-act="debtadd">＋ เพิ่มหนี้</button><button class="btn ghost sm grow" data-act="calall">📅 ลงปฏิทินทั้งหมด</button></div>
  ${r.items.length ? r.items.map(debtCard).join('') : empty('ยังไม่มีรายการหนี้<br>เพิ่มค่างวดรถ บ้าน บัตรเครดิต หรือเงินยืม เพื่อให้เตือนวันครบกำหนด')}
  ${feed ? `<div class="card set" style="margin-top:14px"><h3>📲 ปฏิทินอัตโนมัติ</h3><div class="hint" style="margin-top:0">สมัครรับลิงก์นี้ในแอปปฏิทินครั้งเดียว วันครบกำหนดจะอัปเดตเองทุกครั้งที่จ่ายงวดหรือแก้ไขหนี้ (ต้องเป็น HTTPS)</div><code class="url" id="feedUrl">${esc(feed)}</code><div class="row"><a class="btn sm" style="text-decoration:none;text-align:center" href="${esc(feed)}">สมัครรับปฏิทิน</a><button class="btn ghost sm" data-act="copyfeed">คัดลอกลิงก์</button></div></div>` : ''}`;
};
function debtForm(x) {
  const o = modal(`<h3>${x ? 'แก้ไข' : 'เพิ่ม'}รายการหนี้</h3>
    <label class="f" style="margin-top:0">ชื่อรายการ</label><input class="i" id="dfName" value="${esc(x?.name || '')}" placeholder="เช่น ผ่อนรถ, บัตรเครดิต KTC" maxlength="60">
    <label class="f">เจ้าหนี้ / ธนาคาร</label><input class="i" id="dfCred" value="${esc(x?.creditor || '')}" maxlength="60">
    <div class="fld2"><div><label class="f">ประเภท</label><select class="i" id="dfKind"><option value="monthly" ${x?.kind !== 'once' ? 'selected' : ''}>ผ่อนรายเดือน</option><option value="once" ${x?.kind === 'once' ? 'selected' : ''}>ชำระครั้งเดียว</option></select></div>
      <div><label class="f">วันครบกำหนด (งวดถัดไป)</label>${dateField('dfDue', x?.dueDate || today())}</div></div>
    <div class="fld2"><div><label class="f">ยอดหนี้ทั้งหมด (${cur()})</label><input class="i" type="number" min="0" inputmode="decimal" id="dfPrin" value="${x?.principal ?? ''}"></div>
      <div><label class="f">ยอดคงเหลือ (${cur()})</label><input class="i" type="number" min="0" inputmode="decimal" id="dfRem" value="${x?.remaining ?? ''}" placeholder="เท่ายอดทั้งหมด"></div></div>
    <div class="fld2"><div><label class="f">ค่างวด (${cur()})</label><input class="i" type="number" min="0" inputmode="decimal" id="dfInst" value="${x?.installment || ''}"></div>
      <div><label class="f">จำนวนงวดที่เหลือ</label><input class="i" type="number" min="0" id="dfLeft" value="${x?.installmentsLeft || ''}" placeholder="ไม่ระบุ"></div></div>
    <div class="fld2"><div><label class="f">เตือนล่วงหน้า</label><select class="i" id="dfRemind">${[[0, 'วันครบกำหนด'], [1, '1 วัน'], [3, '3 วัน'], [7, '7 วัน']].map(([v, l]) => `<option value="${v}" ${(x?.remindDays ?? 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label class="f">ผู้รับผิดชอบ</label><select class="i" id="dfMem"><option value="">— ทุกคน —</option>${S.me.members.map(m => `<option value="${m.id}" ${x?.memberId === m.id ? 'selected' : ''}>${emoji(m.avatar)} ${esc(m.name)}</option>`).join('')}</select></div></div>
    <label class="f">บันทึกเพิ่มเติม</label><input class="i" id="dfNote" value="${esc(x?.note || '')}" maxlength="200">
    <div class="gap"></div><button class="btn" id="dfSave">บันทึก</button>`);
  $('#dfSave').onclick = guard(async () => {
    const v = (id) => $('#' + id).value;
    const body = { name: v('dfName'), creditor: v('dfCred'), kind: v('dfKind'), dueDate: getDate('dfDue'), principal: v('dfPrin'), installment: v('dfInst'), installmentsLeft: v('dfLeft'), remindDays: +v('dfRemind'), memberId: v('dfMem'), note: v('dfNote') };
    if (!body.dueDate) throw new Error(BADDATE);
    if (v('dfRem') !== '') body.remaining = v('dfRem'); else if (!x) body.remaining = undefined;
    if (!body.principal && v('dfRem') !== '') body.principal = v('dfRem');
    if (x) await api('/debts/' + x.id, 'PUT', body); else await api('/debts', 'POST', body);
    closeModal(); toast('✓ บันทึกแล้ว', 'good'); render();
  });
}
function payForm(x) {
  const o = modal(`<h3>💸 จ่ายงวดนี้ — ${esc(x.name)}</h3><div class="muted small">ครบกำหนด ${dmy(x.dueDate)} · คงเหลือ ${cur()}${fmt(x.remaining)}</div>
    <label class="f">จำนวนที่จ่าย (${cur()})</label><input class="i" type="number" min="0" inputmode="decimal" id="pfAmt" value="${debtAmt(x)}">
    <label class="f">ใครเป็นคนจ่าย</label><select class="i" id="pfMem">${S.me.members.map(m => `<option value="${m.id}" ${(x.memberId || S.me.members[0].id) === m.id ? 'selected' : ''}>${emoji(m.avatar)} ${esc(m.name)}</option>`).join('')}</select>
    <label class="f">วันที่จ่าย</label>${dateField('pfDate', today())}
    <div class="hint">ระบบจะบันทึกเป็นรายจ่ายในหมวด “หนี้สิน/ผ่อนชำระ” และเลื่อนวันครบกำหนดไปงวดถัดไปให้อัตโนมัติ</div>
    <div class="gap"></div><button class="btn" id="pfSave">ยืนยันการชำระ</button>`);
  $('#pfSave').onclick = guard(async () => {
    const r = await api(`/debts/${x.id}/pay`, 'POST', { amount: $('#pfAmt').value, memberId: $('#pfMem').value, date: getDate('pfDate') || (() => { throw new Error(BADDATE); })() });
    closeModal(); toast(r.debt.status === 'closed' ? '🎉 ปิดหนี้เรียบร้อย' : `✓ ชำระแล้ว งวดถัดไป ${dmy(r.debt.dueDate)}`, 'good'); render();
  });
}
async function deliverICS(name, text) {
  const file = new File([text], name, { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' })); a.download = name; a.click();
  toast('ดาวน์โหลดไฟล์แล้ว — เปิดไฟล์ .ics เพื่อเพิ่มลงปฏิทิน', 'good');
}
function calSheet(items, title) {
  const act = items.filter(x => x.status === 'active'); if (!act.length) return toast('ไม่มีหนี้ที่ต้องลงปฏิทิน', 'err');
  const one = act.length === 1 ? act[0] : null;
  const o = modal(`<h3>📅 ลงปฏิทินโทรศัพท์</h3><div class="muted small">${esc(title)}${one && one.kind === 'monthly' ? ` · ซ้ำทุกเดือน${one.installmentsLeft ? ` (${one.installmentsLeft} งวด)` : ''}` : ''}</div>
    <div class="hint">สร้างกิจกรรมเวลา 09:00 พร้อมแจ้งเตือนล่วงหน้าและเตือนในวันครบกำหนด</div><div class="gap"></div>
    <button class="btn" id="calIcs">เพิ่มลงปฏิทิน (iPhone / Android / Outlook)</button>
    ${one ? '<div class="gap"></div><button class="btn ghost" id="calG">เปิดใน Google Calendar</button>' : ''}`);
  $('#calIcs').onclick = guard(async () => { await deliverICS(one ? `หนี้-${one.name}.ics` : 'หนี้สิน-ทั้งหมด.ics', ICS.calendar(act, { cur: cur(), name: 'หนี้สิน · ' + S.me.family.name })); closeModal(); });
  if (one) $('#calG').onclick = () => { window.open(ICS.googleUrl(one, cur()), '_blank'); closeModal(); };
}
Object.assign(A, {
  debtadd: () => debtForm(null),
  debtedit: (el) => debtForm(S.debts.items.find(x => x.id === el.dataset.id)),
  debtpay: (el) => payForm(S.debts.items.find(x => x.id === el.dataset.id)),
  debtcal: (el) => { const x = S.debts.items.find(y => y.id === el.dataset.id); calSheet([x], x.name); },
  calall: () => calSheet(S.debts.items, 'หนี้ที่ยังค้างทั้งหมด'),
  debtdel: guard(async (el) => { const x = S.debts.items.find(y => y.id === el.dataset.id); if (!confirm(`ลบรายการหนี้ “${x.name}”? (รายจ่ายที่เคยบันทึกไว้จะไม่ถูกลบ)`)) return; await api('/debts/' + x.id, 'DELETE'); render(); }),
  copyfeed: () => navigator.clipboard?.writeText($('#feedUrl').textContent).then(() => toast('คัดลอกแล้ว', 'good')),
});

Object.assign(A, {
  mprev: () => { S.month = shiftMonth(S.month, -1); render(); },
  mnext: () => { S.month = shiftMonth(S.month, 1); render(); },
  dpick: (el) => { const p = document.querySelector(`[data-pick="${el.dataset.for}"]`), iso = getDate(el.dataset.for); if (iso) p.value = iso; try { p.showPicker ? p.showPicker() : p.click(); } catch { p.click(); } },
});
document.addEventListener('input', (e) => {
  if (!e.target.matches?.('[data-df]')) return;
  const d = e.target.value.replace(/\D/g, '').slice(0, 8);
  e.target.value = d.slice(0, 2) + (d.length > 2 ? '/' + d.slice(2, 4) : '') + (d.length > 4 ? '/' + d.slice(4) : '');
});
document.addEventListener('change', (e) => {
  if (!e.target.matches?.('[data-pick]') || !e.target.value) return;
  const t = $('#' + e.target.dataset.pick); t.value = dmy(e.target.value); t.dispatchEvent(new Event('change', { bubbles: true }));
});
function syncSetup() {
  const st = S.setup; if (!st) return;
  st.name = $('#sfName')?.value ?? st.name; st.currency = $('#sfCur')?.value ?? st.currency;
  document.querySelectorAll('.sfm').forEach(i => { st.members[+i.dataset.i].name = i.value; });
}
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el && A[el.dataset.act]) A[el.dataset.act](el, e); });
document.addEventListener('submit', guard(async (e) => {
  if (e.target.id !== 'authForm' && e.target.id !== 'codeForm') return; e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const r = await api(e.target.id === 'codeForm' ? '/login/code' : S.authTab === 'login' ? '/login' : '/register', 'POST', fd);
  S.token = r.token; localStorage.setItem('fb_token', r.token); await boot();
}));
document.addEventListener('keydown', (e) => { // physical keyboard on the add screen
  if (S.view !== 'add' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || $('#modal')) return;
  if (/^[0-9.]$/.test(e.key)) A.key({ dataset: { k: e.key } }); else if (e.key === 'Backspace') A.key({ dataset: { k: '⌫' } });
});

/* ---------- boot ---------- */
/* ---------- live updates (SSE) + auto-update (service worker) ---------- */
let live = null, liveTimer = null;
function stopLive() { if (live) { live.close(); live = null; } clearTimeout(liveTimer); }
function startLive() {
  if (window.LOCAL || !S.token || !window.EventSource) return; stopLive();
  live = new EventSource('/api/events?token=' + encodeURIComponent(S.token));
  live.addEventListener('change', () => { if (Date.now() - (S.lastMut || 0) < 1500) return; clearTimeout(liveTimer); liveTimer = setTimeout(liveRefresh, 400); });
  live.addEventListener('open', () => { if (S.liveSeen) liveRefresh(); S.liveSeen = true; }); // reconnected → catch up
}
async function liveRefresh(tries = 0) {
  if (!S.me?.family || ['auth', 'setup', 'add'].includes(S.view)) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || $('#modal');
  if (typing) { if (tries < 8) liveTimer = setTimeout(() => liveRefresh(tries + 1), 3000); return; } // don't wipe what the user is typing
  try { await refreshMe(); await refreshCats(); await render(); } catch (_) { /* offline */ }
}
/* ---------- install as an app (PWA) ---------- */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installBlock() {
  if (isStandalone()) return '<div class="muted small">✅ ติดตั้งเป็นแอปบนเครื่องนี้แล้ว</div>';
  if (S.installEv) return '<div class="muted small" style="margin-bottom:8px">เพิ่มไอคอนไว้บนหน้าจอ เปิดเต็มจอเหมือนแอปจริง อัปเดตเวอร์ชันให้เอง</div><button class="btn sm" data-act="install">⬇️ ติดตั้งแอป</button>';
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return '<div class="muted small" style="line-height:1.7">บน iPhone/iPad: เปิดด้วย Safari → กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรขึ้น) → <b>เพิ่มไปยังหน้าจอโฮม</b></div>';
  if (!window.isSecureContext) return '<div class="muted small" style="color:var(--orange)">⚠️ ติดตั้งเป็นแอปได้เฉพาะเมื่อเปิดผ่าน https (หรือ localhost) — ดู DEPLOY.md</div>';
  return '<div class="muted small" style="line-height:1.7">เปิดเมนูของเบราว์เซอร์ (⋮ หรือไอคอนติดตั้งที่ช่องที่อยู่) → <b>ติดตั้งแอป</b> / <b>เพิ่มไปยังหน้าจอหลัก</b></div>';
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEv = e; if (S.view === 'settings') render(); });
window.addEventListener('appinstalled', () => { S.installEv = null; toast('ติดตั้งแอปแล้ว', 'good'); if (S.view === 'settings') render(); });

function initPWA() {
  if (window.LOCAL || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  const had = !!navigator.serviceWorker.controller; let reloading = false;
  navigator.serviceWorker.register('/sw.js').then(reg => {
    const check = () => reg.update().catch(() => {});
    setInterval(check, 30 * 60e3); document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had || reloading) return; reloading = true; toast('อัปเดตเป็นเวอร์ชันใหม่แล้ว', 'good'); setTimeout(() => location.reload(), 1200);
  });
}

/* ---------- boot ---------- */
async function boot() {
  const goTo = new URLSearchParams(location.search).get('go'); if (goTo) history.replaceState(null, '', '/');
  if (window.LOCAL) S.token = 'local';
  if (!S.token) return go('auth');
  try { await refreshMe(); } catch { return go('auth'); }
  if (!S.me.family) return go('setup');
  await refreshCats(); S.add = null;
  startLive();
  if (goTo === 'add') addInit();
  go(['add', 'debts'].includes(goTo) ? goTo : 'home');
}
initPWA();
boot();
