/* Minimal QR Code generator (byte mode, ECC level M, versions 1-10). Zero dependencies.
   Works in browser (window.QR) and Node (module.exports). */
(function (root) {
  'use strict';
  // [ecCodewordsPerBlock, [[blockCount, dataCodewordsPerBlock], ...]] for ECC level M, versions 1..10
  const M_TABLE = [null,
    [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
    [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // ---- Reed-Solomon over GF(256), poly 0x11D ----
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  function rsGen(deg) {
    let g = [1];
    for (let i = 0; i < deg; i++) {
      const n = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= gmul(g[j], EXP[i]); }
      g = n;
    }
    return g; // highest degree first, monic
  }
  function rsRemainder(data, deg) {
    const gen = rsGen(deg), rem = new Array(deg).fill(0);
    for (const b of data) {
      const f = b ^ rem.shift(); rem.push(0);
      if (f) for (let i = 0; i < deg; i++) rem[i] ^= gmul(gen[i + 1], f);
    }
    return rem;
  }

  const utf8 = (s) => {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s));
    return Array.from(Buffer.from(s, 'utf8'));
  };
  const dataCap = (v) => M_TABLE[v][1].reduce((a, [n, k]) => a + n * k, 0);

  function makeCodewords(bytes, v) {
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v >= 10 ? 16 : 8);
    for (const b of bytes) put(b, 8);
    const cap = dataCap(v) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (let pad = 0xEC; data.length < dataCap(v); pad ^= 0xEC ^ 0x11) data.push(pad);
    // split into blocks, add EC, interleave
    const [ecLen, groups] = M_TABLE[v];
    const blocks = []; let pos = 0;
    for (const [n, k] of groups) for (let i = 0; i < n; i++) { const d = data.slice(pos, pos + k); pos += k; blocks.push({ d, e: rsRemainder(d, ecLen) }); }
    const out = [], maxD = Math.max(...blocks.map(b => b.d.length));
    for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
    for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i]);
    return out;
  }

  function buildMatrix(codewords, v) {
    const size = v * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { mod[y][x] = !!dark; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, Math.max(Math.abs(dx), Math.abs(dy)) !== 2 && Math.max(Math.abs(dx), Math.abs(dy)) !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = ALIGN[v], n = ap.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = (mask) => {
      const data = (0 << 3) | mask; // ECC M = 00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const b = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, b(i));
      set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (v >= 7) {
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = (v << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) !== 0, a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit); set(b, a, bit);
      }
    }
    // zig-zag data placement
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) { mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
    const applyMask = (mk) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mk](x, y)) mod[y][x] = !mod[y][x]; };
    const penalty = () => {
      let p = 0;
      const line = (get) => {
        for (let a = 0; a < size; a++) {
          let run = 1;
          for (let b = 1; b < size; b++) {
            if (get(a, b) === get(a, b - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
          }
          // finder-like 1:1:3:1:1 with 4 light modules on either side
          for (let b = 0; b + 11 <= size; b++) {
            const s = []; for (let k = 0; k < 11; k++) s.push(get(a, b + k) ? 1 : 0);
            const str = s.join('');
            if (str === '10111010000' || str === '00001011101') p += 40;
          }
        }
      };
      line((a, b) => mod[a][b]); line((a, b) => mod[b][a]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
      let dark = 0; for (const r of mod) for (const c of r) if (c) dark++;
      p += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let mk = 0; mk < 8; mk++) {
      applyMask(mk); drawFormat(mk);
      const p = penalty(); if (p < bestP) { bestP = p; best = mk; }
      applyMask(mk); // undo
    }
    applyMask(best); drawFormat(best);
    return mod;
  }

  function encode(text) {
    const bytes = utf8(String(text));
    let v = 1;
    // capacity check: 4 mode bits + count bits + 8*len <= 8*dataCap
    while (v <= 10 && 4 + (v >= 10 ? 16 : 8) + bytes.length * 8 > dataCap(v) * 8) v++;
    if (v > 10) throw new Error('QR: ข้อความยาวเกินไป');
    const modules = buildMatrix(makeCodewords(bytes, v), v);
    return { version: v, size: modules.length, modules };
  }

  function svg(text, opts) {
    opts = opts || {};
    const q = encode(text), quiet = opts.quiet == null ? 4 : opts.quiet, n = q.size + quiet * 2;
    let d = '';
    for (let y = 0; y < q.size; y++) {
      let x = 0;
      while (x < q.size) {
        if (!q.modules[y][x]) { x++; continue; }
        let e = x; while (e < q.size && q.modules[y][e]) e++;
        d += `M${x + quiet} ${y + quiet}h${e - x}v1h-${e - x}z`; x = e;
      }
    }
    const px = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${px} shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const api = { encode, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QR = api;
})(typeof window !== 'undefined' ? window : this);
