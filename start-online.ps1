# Family Budget — เปิดแอปพร้อมลิงก์ https สำหรับ LINE (Cloudflare quick tunnel)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$port = 3000

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'ยังไม่ได้ติดตั้ง Node.js (เวอร์ชัน 18 ขึ้นไป) -> ดาวน์โหลดที่ https://nodejs.org แล้วลองใหม่' -ForegroundColor Red
  Read-Host 'กด Enter เพื่อปิด'; exit 1
}
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host 'กำลังติดตั้ง cloudflared (ครั้งแรกครั้งเดียว)...' -ForegroundColor Yellow
  try { winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements } catch { }
  Refresh-Path
}
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host 'ติดตั้ง cloudflared อัตโนมัติไม่สำเร็จ -> ติดตั้งเองจาก https://github.com/cloudflare/cloudflared/releases แล้วลองใหม่' -ForegroundColor Red
  Read-Host 'กด Enter เพื่อปิด'; exit 1
}

$log = Join-Path $env:TEMP 'cf-tunnel.log'
Remove-Item $log -ErrorAction SilentlyContinue
Write-Host 'กำลังเปิดอุโมงค์ https ...' -ForegroundColor Cyan
$cf = Start-Process cloudflared -ArgumentList 'tunnel','--url',"http://localhost:$port",'--no-autoupdate','--logfile',$log -PassThru -WindowStyle Hidden
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) {
  Write-Host "เปิดอุโมงค์ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต) ดู log ที่ $log" -ForegroundColor Red
  Stop-Process -Id $cf.Id -Force -ErrorAction SilentlyContinue
  Read-Host 'กด Enter เพื่อปิด'; exit 1
}

$env:PUBLIC_URL = $url
$env:TRUST_PROXY = '1'
$env:PORT = "$port"
Write-Host ''
Write-Host "ลิงก์ https ของคุณ: $url" -ForegroundColor Green
Write-Host "เปิดแอปที่ http://localhost:$port -> ตั้งค่า -> LINE -> คัดลอก Webhook URL ไปวางใน LINE Developers แล้วกด Verify" -ForegroundColor Green
Write-Host 'ปิดหน้าต่างนี้ = ปิดแอปและอุโมงค์ (ลิงก์จะเปลี่ยนทุกครั้งที่เปิดใหม่)' -ForegroundColor Yellow
Write-Host ''
Start-Process "http://localhost:$port"
try { node server.js } finally { Stop-Process -Id $cf.Id -Force -ErrorAction SilentlyContinue }
