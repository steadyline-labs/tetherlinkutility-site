#!/bin/bash
# Tether Link Utility, Mac full-coverage tunnel wrapper (interactive).
#
# Wraps sing-box (https://github.com/SagerNet/sing-box) in TUN mode so the whole
# Mac's traffic, DNS included, routes through the phone's SOCKS5 proxy instead of
# just whatever apps check macOS's native SOCKS proxy setting.
#
# Behavior:
#   1. Checks for Homebrew, warns and exits if missing.
#   2. Installs sing-box via brew if not already installed.
#   3. Reuses ~/Documents/sing-box.config if it holds a previously used IP/port,
#      after asking for confirmation, otherwise prompts for IP and port with validation.
#   4. Writes the sing-box config to that same file (path is announced before writing).
#   5. Starts sing-box in the background, minimizes this Terminal window.
#   6. If sing-box exits unexpectedly, brings the window back to front with an error.
#   7. Stopping this script (Ctrl+C, or closing the window) stops sing-box too.

set -u

CONFIG_FILE="$HOME/Documents/sing-box.config"
NET_STATE_FILE="$HOME/Library/Application Support/TLU/network-restore.txt"  # DNS and IPv6 settings to put back on stop
TUN_DNS="172.19.0.2"                            # inside the tunnel, so DNS is caught by it
mkdir -p "$(dirname "$NET_STATE_FILE")"

# --- DNS through the tunnel ---
# The phone is this Mac's DNS server and sits on the same Wi-Fi, so DNS would
# skip the tunnel. While connected, DNS points inside the tunnel and IPv6 is
# off on that network; both are put back on stop.

# Name of the network service (for example "Wi-Fi") behind the default route.
active_service() {
  local dev
  dev="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  [ -n "$dev" ] || return 0
  networksetup -listnetworkserviceorder 2>/dev/null | awk -v dev="$dev" '
    /^\([0-9*]+\) / { sub(/^\([0-9*]+\) /, ""); name = $0 }
    index($0, "Device: " dev ")") { print name; exit }'
}

flush_dns() {
  sudo dscacheutil -flushcache 2>/dev/null
  sudo killall -HUP mDNSResponder 2>/dev/null || true
}

# $1 = service name. Saves its DNS and IPv6 settings, then points DNS into the tunnel.
set_tunnel_dns() {
  local svc="$1" dns v6 saved=""
  if [ -f "$NET_STATE_FILE" ]; then
    # An earlier restore did not finish: the file still holds the original
    # settings and the service still has the tunnel ones. Never save over it.
    read -r saved < "$NET_STATE_FILE" || true
    [ "$saved" = "$svc" ] || return 0
  else
    dns="$(networksetup -getdnsservers "$svc" 2>/dev/null | grep -E '^[0-9a-fA-F:.]+$' | tr '\n' ' ')"
    v6="$(networksetup -getinfo "$svc" 2>/dev/null | sed -n 's/^IPv6: //p' | head -1)"
    printf '%s\n%s\n%s\n' "$svc" "${dns:-Empty}" "${v6:-Automatic}" > "$NET_STATE_FILE"
  fi
  sudo networksetup -setdnsservers "$svc" "$TUN_DNS"
  sudo networksetup -setv6off "$svc"
  flush_dns
}

# Puts the saved DNS and IPv6 settings back. Safe to call more than once.
# The file is kept (and 1 returned) unless every setting went back, so the
# next stop or the next run tries again with the original settings.
restore_dns() {
  [ -f "$NET_STATE_FILE" ] || return 0
  local svc="" dns="" v6="" ok=1
  { read -r svc; read -r dns; read -r v6; } < "$NET_STATE_FILE" || true
  if [ -n "$svc" ]; then
    # shellcheck disable=SC2086  # several DNS servers, one per word
    sudo networksetup -setdnsservers "$svc" ${dns:-Empty} || ok=0
    case "$v6" in
      Off) ;;
      Link*) sudo networksetup -setv6LinkLocal "$svc" || ok=0 ;;
      *) sudo networksetup -setv6automatic "$svc" || ok=0 ;;
    esac
  fi
  flush_dns
  [ "$ok" = 1 ] || return 1
  rm -f "$NET_STATE_FILE"
}


# --- 1. Homebrew check ---

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew bulunamadı. Bu script'in çalışması için Homebrew gerekiyor."
  echo "Kurulum için: https://brew.sh"
  exit 1
fi

# --- 2. sing-box install if missing ---

# sing-box, telefonun Wi-Fi'ına katılmadan ÖNCE kurulmalı: o Wi-Fi'ın kendi
# interneti olmayabilir, brew orada bir şey indiremez.
if ! command -v sing-box >/dev/null 2>&1; then
  echo "sing-box henüz kurulu değil."
  echo "Mac normal internetteyken, telefonun Wi-Fi'ına katılmadan ÖNCE kurun"
  echo "(o Wi-Fi 'İnternet yok' gösterebilir)."
  if ! curl -fsS --max-time 8 -o /dev/null https://formulae.brew.sh 2>/dev/null; then
    echo ""
    echo "Şu an internet yok, sing-box indirilemiyor."
    echo "Normal Wi-Fi'ınıza dönün, sing-box'ı kurmak için script'i tekrar çalıştırın,"
    echo "sonra telefonun Wi-Fi'ına katılın."
    exit 1
  fi
  echo "sing-box brew ile kuruluyor..."
  if ! brew install sing-box || ! command -v sing-box >/dev/null 2>&1; then
    echo ""
    echo "sing-box kurulamadı. Mac'in normal internette olduğundan emin olun"
    echo "(telefonun Wi-Fi'ı değil), sonra script'i tekrar çalıştırın."
    exit 1
  fi
  echo ""
  echo "sing-box kuruldu. Şimdi telefonun Wi-Fi'ına katılın, sonra buradan devam edin."
  read -rp "Mac telefonun Wi-Fi'ına bağlanınca Enter'a basın... " _
fi

SINGBOX_BIN="$(command -v sing-box)"

# --- Validation helpers ---

valid_ip() {
  local ip="$1"
  if [[ ! "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
    return 1
  fi
  local IFS='.'
  read -ra octets <<< "$ip"
  for o in "${octets[@]}"; do
    if (( o < 0 || o > 255 )); then
      return 1
    fi
  done
  return 0
}

valid_port() {
  local port="$1"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if (( port < 1 || port > 65535 )); then
    return 1
  fi
  return 0
}

prompt_for_ip_port() {
  local ip="" port=""
  while true; do
    read -rp "IP numarası: " ip
    if [ -z "$ip" ]; then
      echo "IP boş olamaz."
      continue
    fi
    if ! valid_ip "$ip"; then
      echo "Geçersiz IP formatı, örnek: 192.168.1.5"
      continue
    fi
    break
  done
  while true; do
    read -rp "Port: " port
    if [ -z "$port" ]; then
      echo "Port boş olamaz."
      continue
    fi
    if ! valid_port "$port"; then
      echo "Geçersiz port, 1-65535 aralığında bir sayı girin."
      continue
    fi
    break
  done
  PHONE_IP="$ip"
  PHONE_PORT="$port"
}

# --- 3+6. Reuse existing config or prompt ---

PHONE_IP=""
PHONE_PORT=""

if [ -f "$CONFIG_FILE" ]; then
  EXISTING_IP="$(python3 -c "import json,sys; d=json.load(open('$CONFIG_FILE')); print(d['outbounds'][0].get('server',''))" 2>/dev/null)"
  EXISTING_PORT="$(python3 -c "import json,sys; d=json.load(open('$CONFIG_FILE')); print(d['outbounds'][0].get('server_port',''))" 2>/dev/null)"
  if [ -n "$EXISTING_IP" ] && [ -n "$EXISTING_PORT" ]; then
    read -rp "Şuna bağlanılacak: $EXISTING_IP:$EXISTING_PORT, onaylıyor musunuz? (e/h): " CONFIRM
    if [[ "$CONFIRM" =~ ^[eE]([vV][eE][tT])?$ ]]; then
      PHONE_IP="$EXISTING_IP"
      PHONE_PORT="$EXISTING_PORT"
    fi
  fi
fi

if [ -z "$PHONE_IP" ] || [ -z "$PHONE_PORT" ]; then
  prompt_for_ip_port
fi

# --- 4. Write config ---

echo "Yapılandırma şu dosyaya yazılacak: $CONFIG_FILE"
mkdir -p "$(dirname "$CONFIG_FILE")"
cat > "$CONFIG_FILE" <<EOF
{
  "log": { "level": "info" },
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
      "auto_route": true, "strict_route": true, "stack": "gvisor" }
  ],
  "outbounds": [
    { "type": "socks", "tag": "phone-socks5", "server": "$PHONE_IP", "server_port": $PHONE_PORT, "version": "5" },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [
      { "port": 53, "action": "hijack-dns" },
      { "ip_cidr": ["$PHONE_IP/32"], "outbound": "direct" },
      { "ip_version": 6, "action": "reject", "no_drop": true }
    ],
    "final": "phone-socks5",
    "auto_detect_interface": true,
    "default_domain_resolver": "remote"
  }
}
EOF

# --- 5. Start sing-box in the background, minimize window ---

echo "Bağlanılıyor: $PHONE_IP:$PHONE_PORT"
echo "sudo şifresi isteyecek, bir kere gir yeter."

sudo -v
restore_dns   # left over from a run that was cut off
SERVICE="$(active_service)"

sudo "$SINGBOX_BIN" run --config "$CONFIG_FILE" &
SINGBOX_PID=$!

cleanup() {
  echo ""
  echo "Durduruluyor..."
  sudo kill "$SINGBOX_PID" 2>/dev/null
  sudo pkill -f "sing-box run --config $CONFIG_FILE" 2>/dev/null
  restore_dns
  exit 0
}
trap cleanup EXIT INT TERM HUP

sleep 2
if ! kill -0 "$SINGBOX_PID" 2>/dev/null; then
  echo "sing-box başlatılamadı, config veya IP/port'u kontrol edin."
  exit 1
fi
if [ -n "$SERVICE" ]; then
  set_tunnel_dns "$SERVICE"
fi

echo "Tünel ayakta. Bu pencere şimdi küçültülecek."
osascript -e 'tell application "Terminal" to set miniaturized of front window to true' 2>/dev/null

# --- 6. Watch it; bring the window back if it dies unexpectedly ---

while kill -0 "$SINGBOX_PID" 2>/dev/null; do
  sleep 2
done

osascript -e 'tell application "Terminal" to set miniaturized of front window to false' \
          -e 'tell application "Terminal" to activate' 2>/dev/null
echo "sing-box beklenmedik şekilde durdu."
exit 1
