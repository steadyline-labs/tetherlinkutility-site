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
rem      While connected, this PC's Wi-Fi uses the tunnel for DNS and has
rem      IPv6 off, so nothing skips the phone app. Both are put back when
rem      you close the window (or on the next run, if that was missed).
rem      If Windows restarts while connected, a small startup task
rem      ("TLU network restore") puts them back and then removes itself.
rem   6. Adds a "TLU connect" shortcut on your desktop for next time.
rem
rem  The only other network call: it reads our small version file
rem  (tetherlinkutility.com/downloads/desktop-versions.txt) and, when a
rem  newer setup file exists, offers to update itself. Nothing is sent
rem  anywhere. The rest of this file is plain PowerShell you can read below.
rem ======================================================================
set "TLU_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($env:TLU_SELF)))"
exit /b
#>

param([string]$AppDir = '', [string]$Desktop = '', [string]$Self = '')

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'TLU connect'

# --- This file's version (desktop-versions.txt "windows=" on the site) ---
$ScriptVersion = 20261123
$ScriptUrl   = 'https://tetherlinkutility.com/downloads/TLU-Windows-Setup.cmd'
$VersionsUrl = 'https://tetherlinkutility.com/downloads/desktop-versions.txt'

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

# --- Network settings while connected --------------------------------------------
# The phone is this PC's DNS server and sits on the same Wi-Fi, so DNS (and IPv6)
# would skip the tunnel and count as hotspot data. While connected, DNS points
# inside the tunnel and IPv6 is off on that adapter; tlu-restore.ps1 puts the
# saved settings back. It runs on stop, when the window is closed, and here at
# the start in case a previous run was cut off.
$TunDns  = '172.19.0.2'
$state   = Join-Path $AppDir 'network-restore.txt'
$restore = Join-Path $AppDir 'tlu-restore.ps1'
$restoreScript = @'
$state = Join-Path $PSScriptRoot 'network-restore.txt'
if (-not (Test-Path $state)) { return }
$guid, $dns, $v6 = Get-Content $state -TotalCount 3
$a = Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue | Where-Object { "$($_.InterfaceGuid)" -eq $guid }
$ok = $true
if ($a) {
  try {
    if ($dns -eq 'dhcp') {
      Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses -ErrorAction Stop
    } else {
      Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses ($dns -split ',') -ErrorAction Stop
    }
  } catch { $ok = $false }
  if ($v6 -eq 'True') {
    try { Enable-NetAdapterBinding -Name $a.Name -ComponentID ms_tcpip6 -ErrorAction Stop } catch { $ok = $false }
  }
  # The DNS command can finish without an error and still change nothing, so check.
  $now = (Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses
  if ($now -contains '172.19.0.2') { $ok = $false }
}
Clear-DnsClientCache -ErrorAction SilentlyContinue
# Keep the file unless every setting went back, so the next run tries again.
if ($ok) {
  Remove-Item $state -Force -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName 'TLU network restore' -Confirm:$false -ErrorAction SilentlyContinue
}
'@
[IO.File]::WriteAllText($restore, $restoreScript, (New-Object Text.UTF8Encoding($false)))
function Restore-Network { & $restore }
Restore-Network   # left over from a run that was cut off

# $ip = the phone. Saves the adapter's DNS and IPv6 settings, then points DNS into the tunnel.
function Set-TunnelNetwork($ip) {
  $ifx = (Find-NetRoute -RemoteIPAddress $ip -ErrorAction SilentlyContinue | Select-Object -First 1).InterfaceIndex
  if (-not $ifx) { return }
  $a = Get-NetAdapter -InterfaceIndex $ifx -ErrorAction SilentlyContinue
  if (-not $a) { return }
  if (Test-Path $state) {
    # An earlier restore did not finish: the file still holds the original settings
    # and the adapter still has the tunnel ones. Never save over it.
    if ("$(Get-Content $state -TotalCount 1)" -ne "$($a.InterfaceGuid)") { return }
  } else {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$($a.InterfaceGuid)"
    $static = (Get-ItemProperty $key -Name NameServer -ErrorAction SilentlyContinue).NameServer
    $dns = if ($static) { (($static -split '[ ,]+') | Where-Object { $_ }) -join ',' } else { 'dhcp' }
    $v6 = (Get-NetAdapterBinding -Name $a.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue).Enabled
    Set-Content -Path $state -Value @("$($a.InterfaceGuid)", $dns, "$v6")
  }
  # A restart while connected never reaches the code that puts the settings back,
  # so a task does it at the next start or sign-in (tlu-restore.ps1 removes it).
  try {
    $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$restore`""
    $trg = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -AtLogOn))
    $trg[0].Delay = 'PT20S'
    $who = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName 'TLU network restore' -Action $act -Trigger $trg -Principal $who -Settings $set -Force | Out-Null
  } catch { }
  Set-DnsClientServerAddress -InterfaceIndex $ifx -ServerAddresses $TunDns
  Disable-NetAdapterBinding -Name $a.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue
  Clear-DnsClientCache
}

# Closing the window with X: Windows gives a few seconds, enough to run tlu-restore.ps1.
if (-not ('TluWindowClose' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class TluWindowClose {
  delegate bool Handler(int ctrlType);
  [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(Handler h, bool add);
  static Handler keep;
  static string script;
  public static void Watch(string path) { script = path; if (keep == null) { keep = OnEvent; SetConsoleCtrlHandler(keep, true); } }
  static bool OnEvent(int ctrlType) {
    if (ctrlType == 2 || ctrlType == 5 || ctrlType == 6) {  // close, logoff, shutdown
      try {
        var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"");
        psi.UseShellExecute = false; psi.CreateNoWindow = true;
        Process.Start(psi).WaitForExit(4500);
      } catch { }
    }
    return false;
  }
}
'@
}
[TluWindowClose]::Watch($restore)

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

# --- 3b. A newer setup file? (direct first, then through the phone) ------------
# Never stops the connection: any problem just keeps this version.
function Get-Url($url, $out, $proxy) {
  $ErrorActionPreference = 'Continue'  # curl's stderr must not become a terminating error
  $a = @('-fsSL', '--connect-timeout', '5', '--max-time', '60')
  if ($proxy) { $a += @('-x', $proxy) }
  if ($out) { $a += @('-o', $out) }
  $r = & curl.exe @a $url 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  if ($out) { return $true } else { return ($r -join "`n") }
}
$via = $null
$versions = Get-Url $VersionsUrl $null $null
if (-not $versions) { $via = "socks5h://$ip`:$port"; $versions = Get-Url $VersionsUrl $null $via }
$latest = 0
if ($versions -match '(?m)^windows=(\d+)\s*$') { $latest = [long]$Matches[1] }
if ($latest -gt $ScriptVersion -and $Self) {
  Say ''
  Say 'A newer version of this setup file is available.' 'Cyan'
  if ((Read-Host 'Update now? (y/n)').Trim() -match '^(y|yes)$') {
    $new = Join-Path $AppDir 'TLU-Windows-Setup.new'
    $ok = (Get-Url $ScriptUrl $new $via) -and (Test-Path $new)
    if ($ok) {
      $text = [IO.File]::ReadAllText($new)
      $ok = $text.StartsWith('<# :') -and ($text -match "(?m)^\`$ScriptVersion = $latest\s*$")
    }
    if ($ok) {
      Copy-Item $new $Self -Force
      Remove-Item $new -Force -ErrorAction SilentlyContinue
      Say 'Updated. Starting the new version ...' 'Green'
      & ([scriptblock]::Create([IO.File]::ReadAllText($Self))) -Self $Self -AppDir $AppDir -Desktop $Desktop
      exit 0
    }
    Remove-Item $new -Force -ErrorAction SilentlyContinue
    Say 'Could not update right now, continuing with this version.' 'Yellow'
  }
}

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
# The tunnel takes two half routes (0.0.0.0/1 and 128.0.0.0/1) instead of one
# default route: when the phone stops answering for a few seconds, Windows can
# switch its default route back to the Wi-Fi and keep it there, which would send
# everything past the phone app. Half routes always win over a default route.
$config = @'
{
  "log": { "level": "info", "timestamp": true, "output": "sing-box.log" },
  "dns": {
    "servers": [
      { "type": "tcp", "tag": "remote", "server": "8.8.8.8", "detour": "phone-socks5" },
      { "type": "local", "tag": "local", "detour": "direct" }
    ],
    "rules": [ { "query_type": ["AAAA", "HTTPS"], "action": "predefined" } ],
    "final": "remote",
    "strategy": "ipv4_only"
  },
  "inbounds": [
    { "type": "tun", "tag": "tun-in", "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"], "mtu": 1500,
      "route_address": ["0.0.0.0/1", "128.0.0.0/1", "::/1", "8000::/1"],
      "auto_route": true, "strict_route": true, "stack": "gvisor" }
  ],
  "outbounds": [
    { "type": "socks", "tag": "phone-socks5", "server": "PHONE_IP", "server_port": PHONE_PORT, "version": "5" },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [
      { "port": 53, "action": "hijack-dns" },
      { "ip_cidr": ["PHONE_IP/32"], "outbound": "direct" },
      { "ip_version": 6, "action": "reject", "no_drop": true }
    ],
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

# sing-box writes its log to sing-box.log (set in config.json, info level, fresh
# each run); errors from before the log starts go to sing-box-errors.log.
$log = Join-Path $AppDir 'sing-box.log'
$err = Join-Path $AppDir 'sing-box-errors.log'
Remove-Item $log -Force -ErrorAction SilentlyContinue
Say 'Starting ...'
Set-TunnelNetwork $ip
$p = Start-Process -FilePath $exe -ArgumentList @('run', '-c', "`"$cfgPath`"") -WorkingDirectory $AppDir `
     -NoNewWindow -PassThru -RedirectStandardError $err
Start-Sleep -Seconds 4
if ($p.HasExited) {
  $tail = @(Get-Content $err -Tail 5 -ErrorAction SilentlyContinue) + @(Get-Content $log -Tail 5 -ErrorAction SilentlyContinue)
  Say ($tail -join "`n") 'DarkGray'
  Restore-Network
  Fail "sing-box stopped right away. Details are in $log and $err"
}

# --- 7. Check that traffic really goes through the phone ---------------------------
# A running sing-box is not proof: the tunnel must hold the default route and a test
# page must load through the phone's port (sing-box logs that connection).
# Returns $null when it works, otherwise what is wrong in plain words.
function Test-Tunnel {
  $tun = (Get-NetIPAddress -IPAddress '172.19.0.1' -ErrorAction SilentlyContinue | Select-Object -First 1).InterfaceIndex
  if (-not $tun) { return 'the network tunnel was not created' }
  $via = (Find-NetRoute -RemoteIPAddress '1.1.1.1' -ErrorAction SilentlyContinue | Select-Object -First 1).InterfaceIndex
  if ($via -ne $tun) { return 'Windows is not sending traffic into the tunnel' }
  $code = & curl.exe -4 -s -o NUL -w '%{http_code}' --max-time 10 'http://www.gstatic.com/generate_204' 2>$null
  if ($code -ne '204') { return 'a test page did not load through the phone' }
  $seen = Select-String -Path $log -SimpleMatch 'outbound/socks[phone-socks5]: outbound connection to' -Quiet -ErrorAction SilentlyContinue
  if (-not $seen) { return 'the test page did not go through the phone' }
  return $null
}
Say 'Checking the connection through the phone ...'
$problem = 'not checked'
for ($try = 0; $try -lt 4 -and $problem -and -not $p.HasExited; $try++) {
  if ($try) { Start-Sleep -Seconds 3 }
  $problem = Test-Tunnel
}
if ($p.HasExited) { $problem = 'sing-box stopped' }
if ($problem) {
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  Restore-Network
  $tail = @(Get-Content $err -Tail 5 -ErrorAction SilentlyContinue) + @(Get-Content $log -Tail 5 -ErrorAction SilentlyContinue)
  Say ($tail -join "`n") 'DarkGray'
  Fail "Not connected: $problem. Turn sharing off and on in the app, then run this file again. Details are in $log"
}

Say ''
Say 'Connected. Keep this window open. Close it to stop.' 'Green'
Say "(Next time: double-click 'TLU connect' on your desktop.)" 'DarkGray'
try { $p.WaitForExit() } finally { Restore-Network }
Say ''
Say 'sing-box stopped.' 'Yellow'
Read-Host 'Press Enter to close'
