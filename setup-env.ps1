# สร้างไฟล์ .env แบบถามทีละข้อ (กุญแจจะไม่แสดงบนจอ และไม่ถูกส่งไปที่ไหน)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Ask($label) {
  $s = Read-Host -AsSecureString $label
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
Write-Host 'ใส่เฉพาะกุญแจที่คุณมี ตัวไหนไม่มีให้กด Enter ข้าม' -ForegroundColor Cyan
$g = Ask 'GEMINI_API_KEY (Google AI Studio)'
$o = Ask 'OPENAI_API_KEY (GPT)'
$a = Ask 'ANTHROPIC_API_KEY (Claude)'
$lines = @('# สร้างโดย setup-env — ห้ามส่งไฟล์นี้ให้ใครหรืออัปโหลดขึ้น GitHub')
if ($g) { $lines += "GEMINI_API_KEY=$g" }
if ($o) { $lines += "OPENAI_API_KEY=$o" }
if ($a) { $lines += "ANTHROPIC_API_KEY=$a" }
if ($lines.Count -eq 1) { Write-Host 'ไม่ได้ใส่กุญแจเลย จึงไม่สร้างไฟล์' -ForegroundColor Yellow; Read-Host 'กด Enter เพื่อปิด'; exit 1 }
$path = Join-Path $PSScriptRoot '.env'
[IO.File]::WriteAllLines($path, $lines, (New-Object Text.UTF8Encoding($false)))
Write-Host "สร้างไฟล์ $path แล้ว -> ปิดและเปิดแอปใหม่ด้วย start-online.bat" -ForegroundColor Green
Read-Host 'กด Enter เพื่อปิด'
