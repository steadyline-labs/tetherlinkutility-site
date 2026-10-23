<# :
@echo off
rem ======================================================================
rem  Tether Link Utility (TLU) - Windows setup
rem  https://tetherlinkutility.com
rem
rem  Connects this PC to your phone's internet through the TLU app, for
rem  every app on the PC (DNS included), using sing-box in TUN mode.
rem
rem  What it does:
rem   1. Asks Windows for administrator rights (needed for the network
rem      adapter sing-box creates).
rem   2. Asks for the IP and port shown in the TLU app.
rem   3. Checks that the phone answers on that port.
rem   4. Downloads sing-box 1.14.3 from its official GitHub releases page
rem      (only the first time) and checks its SHA256 hash.
rem   5. Saves everything in %LOCALAPPDATA%\TLU and starts sing-box.
rem   6. Adds a "TLU connect" shortcut on your desktop for next time.
rem
rem  No other network calls, nothing is sent anywhere. The rest of this
rem  file is plain PowerShell you can read below.
rem ======================================================================
set "TLU_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($env:TLU_SELF)))"
exit /b
#>

param([string]$AppDir = '', [string]$Desktop = '', [string]$Self = '')

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'TLU connect'

# --- Pinned sing-box release and its SHA256 hashes (from the official release) ---
$Version = '1.14.3'
$Hashes  = @{
  'amd64' = 'd8b86ef58936dba9230ec6a57ffa4243933f3c14ef4809828b6c553440ed1518'
  'arm64' = '195b35424c6e3f5913954c7f08c5d8ba2d2199f6d18eb27a3972a5a29cdaa78c'
}

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail($text) {
  Say ''
  Say $text 'Red'
  Say ''
  Read-Host 'Press Enter to close'
  exit 1
}

# --- 1. Administrator rights ---------------------------------------------------
# Folders are taken from the normal (not elevated) user, then the script restarts
# itself as administrator with them, so files land in your own user folder.
if (-not $Self)    { $Self    = $env:TLU_SELF }
if (-not $AppDir)  { $AppDir  = Join-Path $env:LOCALAPPDATA 'TLU' }
if (-not $Desktop) { $Desktop = [Environment]::GetFolderPath('Desktop') }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $q = { param($s) "'" + ($s -replace "'", "''") + "'" }
  $cmd = "& ([scriptblock]::Create([IO.File]::ReadAllText($(& $q $Self)))) " +
         "-Self $(& $q $Self) -AppDir $(& $q $AppDir) -Desktop $(& $q $Desktop)"
  try {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd)
  } catch {
    Fail 'Administrator rights are needed. Run the file again and click Yes.'
  }
  exit 0
}

Say ''
Say 'Tether Link Utility - connect this PC to your phone' 'Cyan'
Say '----------------------------------------------------'
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
$saved = Join-Path $AppDir 'phone.txt'   # last IP and port you entered

# Stop a copy that is already running from our folder (safe to run again).
Get-Process sing-box -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like "$AppDir\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# --- 2. Phone IP and port ------------------------------------------------------
# True if a SOCKS5 server answers there (a short local greeting, no internet).
function Test-Port($ip, $port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    if (-not $c.ConnectAsync($ip, [int]$port).Wait(3000)) { $c.Close(); return $false }
    $s = $c.GetStream(); $s.ReadTimeout = 3000
    $s.Write([byte[]](5, 1, 0), 0, 3)            # SOCKS5, one method: no auth
    $r = New-Object byte[] 2
    $ok = ($s.Read($r, 0, 2) -eq 2) -and $r[0] -eq 5 -and $r[1] -eq 0
    $c.Close(); return $ok
  } catch { return $false }
}

# On the phone's hotspot the phone is the Wi-Fi default gateway.
$gateway = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
  Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
  Sort-Object { if ($_.NetAdapter.PhysicalMediaType -match '802\.11') { 0 } else { 1 } } |
  ForEach-Object { $_.IPv4DefaultGateway.NextHop } | Select-Object -First 1

$lastIp = ''; $lastPort = ''
if (Test-Path $saved) { $lastIp, $lastPort = (Get-Content $saved -TotalCount 2) }

$suggestIp = $gateway
if ($lastIp -and $lastPort -and (Test-Port $lastIp $lastPort)) { $suggestIp = $lastIp }

Say ''
Say 'Open TLU on your phone and start sharing. It shows an IP and a port.'
$prompt = 'Phone IP'; if ($suggestIp) { $prompt += " [press Enter for $suggestIp]" }
$ip = (Read-Host $prompt).Trim(); if (-not $ip) { $ip = $suggestIp }
$prompt = 'Port'; if ($lastPort) { $prompt += " [press Enter for $lastPort]" }
$port = (Read-Host $prompt).Trim(); if (-not $port) { $port = $lastPort }

if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { Fail "That IP doesn't look right: '$ip'. Type it exactly as the app shows it." }
if ($port -notmatch '^\d{1,5}$' -or [int]$port -gt 65535) { Fail "That port doesn't look right: '$port'." }

# --- 3. Can we reach the phone? -----------------------------------------------
Say "Checking $ip`:$port ..."
if (-not (Test-Port $ip $port)) {
  Fail "Can't reach your phone. Make sure the PC is on the phone's Wi-Fi and sharing is on in the app."
}
Set-Content -Path $saved -Value @($ip, $port)
Say 'Phone found.' 'Green'

# --- 4. sing-box (downloaded once, hash checked) -------------------------------
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($arch) { 'AMD64' { 'amd64' } 'ARM64' { 'arm64' } default { '' } }
if (-not $arch) { Fail 'This PC type is not supported (64-bit Windows is needed).' }

$name = "sing-box-$Version-windows-$arch"
$exe  = Join-Path $AppDir "$name\sing-box.exe"
if (-not (Test-Path $exe)) {
  $zip = Join-Path $AppDir "$name.zip"
  $url = "https://github.com/SagerNet/sing-box/releases/download/v$Version/$name.zip"
  Say "Downloading sing-box $Version ($arch), about 30 MB ..."
  # Built-in curl.exe: try directly first, then through the phone.
  & curl.exe -fL --connect-timeout 10 --speed-limit 1000 --speed-time 30 -o $zip $url
  if ($LASTEXITCODE -ne 0) {
    Say 'Trying through the phone ...'
    & curl.exe -fL --connect-timeout 15 --speed-limit 1000 --speed-time 30 -x "socks5h://$ip`:$port" -o $zip $url
  }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $zip)) { Fail 'Download failed. Check that sharing is on in the app and run this file again.' }

  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $Hashes[$arch]) {
    Remove-Item $zip -Force
    Fail 'The downloaded file did not pass the safety check (SHA256 mismatch). Nothing was installed.'
  }
  Say 'Download checked (SHA256 OK).' 'Green'
  Expand-Archive -Path $zip -DestinationPath $AppDir -Force
  Remove-Item $zip -Force
}

# --- 5. config.json and start --------------------------------------------------
# Same config as the guide on tetherlinkutility.com: all traffic and DNS go to
# the phone's SOCKS5 port; the connection to the phone itself goes direct.
$config = @'
{
  "dns": {
    "servers": [
      { "type": "udp", "tag": "remote", "server": "8.8.8.8", "detour": "phone-socks5" },
      { "type": "local", "tag": "local", "detour": "direct" }
    ],
    "final": "remote"
  },
  "inbounds": [
    { "type": "tun", "tag": "tun-in", "address": ["172.19.0.1/30"], "mtu": 1500,
      "auto_route": true, "strict_route": true, "stack": "system" }
  ],
  "outbounds": [
    { "type": "socks", "tag": "phone-socks5", "server": "PHONE_IP", "server_port": PHONE_PORT, "version": "5" },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [ { "ip_cidr": ["PHONE_IP/32"], "outbound": "direct" } ],
    "final": "phone-socks5",
    "auto_detect_interface": true,
    "default_domain_resolver": "remote"
  }
}
'@
$config = $config.Replace('PHONE_IP', $ip).Replace('PHONE_PORT', $port)
$cfgPath = Join-Path $AppDir 'config.json'
[IO.File]::WriteAllText($cfgPath, $config, (New-Object Text.UTF8Encoding($false)))

# --- 6. Desktop shortcut "TLU connect" (runs this file again, no re-download) ---
$copy = Join-Path $AppDir 'TLU-Windows-Setup.cmd'
if ($Self -and ((Resolve-Path $Self).Path -ne $copy)) { Copy-Item $Self $copy -Force }
try {
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $Desktop 'TLU connect.lnk'))
  $lnk.TargetPath = $copy
  $lnk.WorkingDirectory = $AppDir
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'Connect this PC to the phone through Tether Link Utility'
  $lnk.Save()
} catch { Say 'Could not create the desktop shortcut (not needed to connect).' 'Yellow' }

$log = Join-Path $AppDir 'sing-box.log'
$err = Join-Path $AppDir 'sing-box-errors.log'
Say 'Starting ...'
$p = Start-Process -FilePath $exe -ArgumentList @('run', '-c', "`"$cfgPath`"") -WorkingDirectory $AppDir `
     -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError $err
Start-Sleep -Seconds 4
if ($p.HasExited) {
  Say ((Get-Content $err -Tail 5 -ErrorAction SilentlyContinue) -join "`n") 'DarkGray'
  Fail "sing-box stopped right away. Details are in $err"
}

Say ''
Say 'Connected. Keep this window open. Close it to stop.' 'Green'
Say "(Next time: double-click 'TLU connect' on your desktop.)" 'DarkGray'
$p.WaitForExit()
Say ''
Say 'sing-box stopped.' 'Yellow'
Read-Host 'Press Enter to close'
