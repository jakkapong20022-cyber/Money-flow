# คู่มือ Deploy (ให้ LINE OA ใช้งานจริง)

แอปเป็น Node.js ล้วน ไม่ต้อง `npm install` ข้อมูลเก็บเป็นไฟล์ใน `DATA_DIR` (ค่าเริ่มต้นใน Docker คือ `/data`)
**ต้องมี disk ถาวร** ไม่เช่นนั้นข้อมูลจะหายเมื่อ redeploy/restart

## ทางเลือก A — VPS / เครื่องของคุณ (Docker)
```bash
git clone https://github.com/jakkapong20022-cyber/Money-flow.git && cd Money-flow
cp .env.example .env     # แก้ PUBLIC_URL และ ANTHROPIC_API_KEY
docker compose up -d --build
```
จากนั้นใส่ HTTPS หน้าแอป (เลือกอย่างใดอย่างหนึ่ง):
- **Caddy** (ง่ายสุด ออกใบรับรองให้เอง): `budget.example.com { reverse_proxy localhost:3000 }`
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3000` (ใช้ทดสอบได้ทันที ไม่ต้องมีโดเมน)

## ทางเลือก B — Render
1. Push repo นี้ขึ้น GitHub (ทำแล้ว) → Render → New → Blueprint → เลือก repo (ใช้ `render.yaml`)
2. ใส่ `PUBLIC_URL` = `https://<ชื่อบริการ>.onrender.com` และ `ANTHROPIC_API_KEY`
3. แผน `starter` พร้อม disk 1 GB มีค่าใช้จ่ายรายเดือน (แผน Free ไม่มี disk ถาวร ไม่เหมาะ)

## ทางเลือก C — Railway / Fly.io
ใช้ `Dockerfile` ตามเดิม สร้าง **Volume** แล้ว mount ที่ `/data` ตั้งค่า env เหมือนข้างบน

## หลัง deploy
1. เปิด `PUBLIC_URL` → สมัครสมาชิก → ตั้งค่าครอบครัว
2. **ตั้งค่า → LINE Official Account**: วาง Channel secret + Channel access token → บันทึก
3. ที่ LINE Developers ตั้ง Webhook URL ตามที่แอปแสดง (`https://โดเมน/webhook/line/<familyId>`) → Verify → เปิด Use webhook, ปิด Auto-reply
4. กด "สร้างรหัส" ของสมาชิก → ให้สมาชิกสแกน QR ด้วย LINE (ข้อความ `ผูก 123456` จะขึ้นรอในแชท OA แค่กดส่ง) → กด "ส่งข้อความทดสอบ"
   - QR ต้องรู้ LINE ID ของ OA: ระบบดึงให้อัตโนมัติจาก Channel access token หรือกรอกเองในหน้าตั้งค่า

## ความปลอดภัย / ดูแลระบบ
- อย่า commit `.env`, Channel secret, token หรือ API key
- สำรองข้อมูล: แอป → ตั้งค่า → สำรองข้อมูล (หรือ copy โฟลเดอร์ `/data` / volume)
- ตรวจสุขภาพ: `GET /healthz` → `{"ok":true}`
- ข้อมูลเก็บเป็นไฟล์ JSON เหมาะกับครอบครัวเดียว/จำนวนไม่มาก

## เข้าสู่ระบบด้วย LINE และอัปเดตอัตโนมัติ

**LINE Login** — ให้สมาชิกกด "เข้าสู่ระบบด้วย LINE" แทนอีเมล/รหัสผ่าน
1. ที่ developers.line.biz สร้างช่องทางประเภท **LINE Login** ใน **Provider เดียวกัน** กับ Messaging API ของ OA (ต้องเป็น Provider เดียวกัน userId จึงตรงกับที่ผูกไว้)
2. ตั้ง **Callback URL** = `https://โดเมนของคุณ/auth/line/callback` และเปลี่ยนสถานะช่องทางเป็น Published
3. ใส่ `LINE_LOGIN_CHANNEL_ID` และ `LINE_LOGIN_CHANNEL_SECRET` ใน environment แล้วรีสตาร์ต — ปุ่มจะขึ้นที่หน้าเข้าสู่ระบบเอง
4. ใช้ได้เฉพาะสมาชิกที่ผูกบัญชี LINE แล้ว (สแกน QR ในหน้าตั้งค่า) — บัญชี LINE ที่ยังไม่ผูกจะถูกปฏิเสธ

**อัปเดตอัตโนมัติ**
- ข้อมูลซิงก์ข้ามเครื่องแบบเรียลไทม์ (SSE): เมื่อใครบันทึกรายการ ไม่ว่าจากแอปหรือ LINE หน้าจอของคนอื่นที่เปิดอยู่จะรีเฟรชเอง (ไม่รีเฟรชถ้ากำลังพิมพ์/เปิดหน้าต่างอยู่) หากใช้ reverse proxy ให้ปิด buffering ของ `/api/events` (เซิร์ฟเวอร์ส่งเฮดเดอร์ `X-Accel-Buffering: no` ให้แล้ว)
- แอปเป็น PWA: เปิดผ่าน HTTPS แล้ว "เพิ่มไปยังหน้าจอโฮม" ได้ เมื่อ deploy เวอร์ชันใหม่ แอปจะตรวจเจอเองและรีโหลด (ทำงานแม้ออฟไลน์ด้วยข้อมูลที่แคชหน้าจอไว้)
