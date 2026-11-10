'use strict';
// Tiny .env loader (no dependencies). Real environment variables win over the file.
const fs = require('fs'), path = require('path');
try {
  for (let line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    line = line.trim(); if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 1) continue;
    const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim();
    const q = v.match(/^(['"])(.*?)\1/); v = q ? q[2] : v.replace(/\s+#.*$/, '').trim();
    if (v && process.env[k] === undefined) process.env[k] = v;
  }
} catch (_) { /* no .env file — fine */ }
