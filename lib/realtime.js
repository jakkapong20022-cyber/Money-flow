'use strict';
// Server-Sent Events: tell every open app of a family that something changed so it refreshes itself.
const clients = new Map(); // familyId -> Set<res>

function subscribe(familyId, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  let set = clients.get(familyId); if (!set) clients.set(familyId, set = new Set());
  set.add(res);
  const hb = setInterval(() => res.write(': hb\n\n'), 25000);
  res.on('close', () => { clearInterval(hb); set.delete(res); if (!set.size) clients.delete(familyId); });
}
function broadcast(familyId) {
  const set = clients.get(familyId); if (!set) return;
  const msg = `event: change\ndata: ${Date.now()}\n\n`;
  for (const r of set) try { r.write(msg); } catch (_) { /* closed */ }
}
const count = (familyId) => (clients.get(familyId) || new Set()).size;
module.exports = { subscribe, broadcast, count };
