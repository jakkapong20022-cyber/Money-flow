'use strict';
// Bundle everything into ONE self-contained html: node build/build-html.js → dist/family-budget.html
const fs = require('fs'), path = require('path');
const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const ICS_SRC = R('public/ics.js');
const mods = { './util': R('lib/util.js'), './defaults': R('lib/defaults.js'), './core': R('lib/core.js') };
const storeShim = `
const KEY='family-budget-v1'; const empty=()=>({users:[],sessions:{},families:[],members:[],categories:[],transactions:[],debts:[]});
let db=empty(); try{db=Object.assign(empty(),JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(e){}
let t=null; const flush=()=>{try{localStorage.setItem(KEY,JSON.stringify(db))}catch(e){alert('บันทึกข้อมูลไม่สำเร็จ (พื้นที่เต็มหรือถูกบล็อก)')}};
const save=()=>{if(t)return;t=setTimeout(()=>{t=null;flush()},100)}; addEventListener('pagehide',()=>{if(t){clearTimeout(t);t=null;flush()}});
const uid=(p='')=>p+[...crypto.getRandomValues(new Uint8Array(8))].map(b=>b.toString(16).padStart(2,'0')).join('');
module.exports={db:()=>db,save,flush,uid};`;
const cryptoShim = `module.exports={randomBytes:n=>{const a=crypto.getRandomValues(new Uint8Array(n));return{toString:()=>[...a].map(b=>b.toString(16).padStart(2,'0')).join('')}}}`;
const bundle = `(function(){const defs={'./store':function(module,exports,require){${storeShim}},'crypto':function(module){${cryptoShim}},
${Object.entries(mods).map(([k, v]) => `'${k}':function(module,exports,require){${v}}`).join(',\n')}};
const cache={};function req(n){if(cache[n])return cache[n].exports;const m={exports:{}};cache[n]=m;defs[n](m,m.exports,req);return m.exports}
const store=req('./store'),U=req('./util'),core=req('./core');
const parseSlipText=(function(){const module={exports:{}};${R('build/ocr-parse.js')}\nreturn module.exports.parseSlipText})();
${R('build/local.js')}
})();`;
const icon = 'data:image/svg+xml;base64,' + Buffer.from(R('public/icon.svg')).toString('base64');
const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#090c12">
<title>Family Budget · รายรับรายจ่ายครอบครัว</title><link rel="icon" href="${icon}">
<style>${R('public/app.css')}</style></head><body><div id="app"></div>
<script>${bundle}</script>
<script>${ICS_SRC}</script>
<script>${R('public/app.js')}</script></body></html>`;
const inner = html.split('</script>').length - 1;
if (inner !== 3) throw new Error('unexpected </script> inside sources: ' + inner);
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'family-budget.html'), html);
console.log('dist/family-budget.html', (html.length / 1024).toFixed(0) + ' KB');
