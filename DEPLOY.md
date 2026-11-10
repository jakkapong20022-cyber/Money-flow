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
4. กด "สร้างรหัส" ของสมาชิก → ส่ง `ผูก 123456` ใน LINE → กด "ส่งข้อความทดสอบ"

## ความปลอดภัย / ดูแลระบบ
- อย่า commit `.env`, Channel secret, token หรือ API key
- สำรองข้อมูล: แอป → ตั้งค่า → สำรองข้อมูล (หรือ copy โฟลเดอร์ `/data` / volume)
- ตรวจสุขภาพ: `GET /healthz` → `{"ok":true}`
- ข้อมูลเก็บเป็นไฟล์ JSON เหมาะกับครอบครัวเดียว/จำนวนไม่มาก
