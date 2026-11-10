'use strict';
// "Log in with LINE" (LINE Login, OAuth 2.1). Needs a LINE Login channel under the SAME provider as the
// Messaging API channel, so the userId matches the one stored when a member linked their account.
const crypto = require('crypto');
const cfg = () => ({ id: process.env.LINE_LOGIN_CHANNEL_ID || '', secret: process.env.LINE_LOGIN_CHANNEL_SECRET || '' });
const enabled = () => { const c = cfg(); return !!(c.id && c.secret) || !!process.env.LINE_LOGIN_MOCK; };

const states = new Map(); // state -> expiry
const codes = new Map();  // one-time app code -> { userId, exp }
const sweep = (m) => { const now = Date.now(); for (const [k, v] of m) if ((v.exp || v) < now) m.delete(k); };

function startUrl(redirectUri) {
  sweep(states);
  const state = crypto.randomBytes(16).toString('hex'); states.set(state, Date.now() + 10 * 60e3);
  const q = new URLSearchParams({ response_type: 'code', client_id: cfg().id, redirect_uri: redirectUri, state, scope: 'profile' });
  return process.env.LINE_LOGIN_MOCK ? `${redirectUri}?${new URLSearchParams({ code: 'mock:' + (process.env.LINE_LOGIN_MOCK_USER || 'Umock'), state })}` : 'https://access.line.me/oauth2/v2.1/authorize?' + q;
}
const checkState = (s) => { const ok = states.has(s) && states.get(s) > Date.now(); states.delete(s); return ok; };

async function lineUserId(code, redirectUri) {
  if (process.env.LINE_LOGIN_MOCK && code.startsWith('mock:')) return code.slice(5);
  const c = cfg();
  const tr = await fetch('https://api.line.me/oauth2/v2.1/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: c.id, client_secret: c.secret }) });
  if (!tr.ok) throw new Error('token ' + tr.status);
  const { access_token } = await tr.json();
  const pr = await fetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + access_token } });
  if (!pr.ok) throw new Error('profile ' + pr.status);
  return (await pr.json()).userId;
}
function issueCode(userId) { sweep(codes); const code = crypto.randomBytes(24).toString('hex'); codes.set(code, { userId, exp: Date.now() + 2 * 60e3 }); return code; }
function takeCode(code) { const e = codes.get(code); codes.delete(code); return e && e.exp > Date.now() ? e.userId : null; }

module.exports = { enabled, startUrl, checkState, lineUserId, issueCode, takeCode };
