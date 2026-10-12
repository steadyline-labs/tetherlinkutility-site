#!/bin/bash
# Tether Link Utility, Mac full-coverage tunnel wrapper.
#
# Wraps sing-box (https://github.com/SagerNet/sing-box) in TUN mode so your
# whole Mac's traffic, DNS included, routes through the phone's SOCKS5 proxy,
# instead of just whatever apps check macOS's native SOCKS proxy setting.
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

# --- 1. Homebrew check ---

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew not found. This script requires Homebrew."
  echo "Install it from: https://brew.sh"
  exit 1
fi

# --- 2. sing-box install if missing ---

if ! command -v sing-box >/dev/null 2>&1; then
  echo "sing-box not found, installing via brew..."
  brew install sing-box
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
    read -rp "Phone IP address: " ip
    if [ -z "$ip" ]; then
      echo "IP address cannot be empty."
      continue
    fi
    if ! valid_ip "$ip"; then
      echo "Invalid IP format, example: 192.168.1.5"
      continue
    fi
    break
  done
  while true; do
    read -rp "Port: " port
    if [ -z "$port" ]; then
      echo "Port cannot be empty."
      continue
    fi
    if ! valid_port "$port"; then
      echo "Invalid port, enter a number between 1 and 65535."
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
    read -rp "Connect to $EXISTING_IP:$EXISTING_PORT? (y/n): " CONFIRM
    if [[ "$CONFIRM" =~ ^[yY]([eE][sS])?$ ]]; then
      PHONE_IP="$EXISTING_IP"
      PHONE_PORT="$EXISTING_PORT"
    fi
  fi
fi

if [ -z "$PHONE_IP" ] || [ -z "$PHONE_PORT" ]; then
  prompt_for_ip_port
fi

# --- 4. Write config ---

echo "Config will be written to: $CONFIG_FILE"
mkdir -p "$(dirname "$CONFIG_FILE")"
cat > "$CONFIG_FILE" <<EOF
{
  "log": { "level": "info" },
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
    { "type": "socks", "tag": "phone-socks5", "server": "$PHONE_IP", "server_port": $PHONE_PORT, "version": "5" },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [ { "ip_cidr": ["$PHONE_IP/32"], "outbound": "direct" } ],
    "final": "phone-socks5",
    "auto_detect_interface": true,
    "default_domain_resolver": "remote"
  }
}
EOF

# --- 5. Start sing-box in the background, minimize window ---

echo "Connecting to: $PHONE_IP:$PHONE_PORT"
echo "This will ask for your sudo password once."

sudo -v

sudo "$SINGBOX_BIN" run --config "$CONFIG_FILE" &
SINGBOX_PID=$!

cleanup() {
  echo ""
  echo "Stopping..."
  sudo kill "$SINGBOX_PID" 2>/dev/null
  sudo pkill -f "sing-box run --config $CONFIG_FILE" 2>/dev/null
  exit 0
}
trap cleanup EXIT INT TERM

sleep 2
if ! kill -0 "$SINGBOX_PID" 2>/dev/null; then
  echo "sing-box failed to start, check your config or IP/port."
  exit 1
fi

minimize_window() {
  case "${TERM_PROGRAM:-}" in
    Apple_Terminal)
      osascript -e 'tell application "Terminal" to set miniaturized of front window to true' 2>/dev/null
      ;;
    iTerm.app)
      osascript -e 'tell application "iTerm2" to tell current window to set miniaturized to true' 2>/dev/null
      ;;
    *)
      echo "(Not running in Terminal.app or iTerm2, skipping auto-minimize. You can minimize this window yourself.)"
      ;;
  esac
}

restore_window() {
  case "${TERM_PROGRAM:-}" in
    Apple_Terminal)
      osascript -e 'tell application "Terminal" to set miniaturized of front window to false' \
                -e 'tell application "Terminal" to activate' 2>/dev/null
      ;;
    iTerm.app)
      osascript -e 'tell application "iTerm2" to tell current window to set miniaturized to false' \
                -e 'tell application "iTerm2" to activate' 2>/dev/null
      ;;
  esac
}

echo "Tunnel is up. This window will minimize now."
minimize_window

# --- 6. Watch it; bring the window back if it dies unexpectedly ---

while kill -0 "$SINGBOX_PID" 2>/dev/null; do
  sleep 2
done

restore_window
echo "sing-box stopped unexpectedly."
exit 1
