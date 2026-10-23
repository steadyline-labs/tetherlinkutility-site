#!/bin/bash
# Tether Link Utility (TLU), Mac connection for every app.
# https://tetherlinkutility.com
#
# Runs sing-box (https://github.com/SagerNet/sing-box, open source) in TUN
# mode, so every app on this Mac, DNS included, uses the phone's internet
# through the TLU app. Homebrew is not needed.
#
# What it does:
#   1. Finds sing-box: our own copy, or Homebrew's if you already have it.
#      Otherwise it downloads sing-box 1.14.3 once from its official GitHub
#      releases page while this Mac still has its own internet, and checks
#      its SHA256 hash. If that download fails, it tries again through the
#      phone after you enter the IP and port.
#   2. Asks for the IP and port shown in the TLU app (or offers the last
#      ones), and checks that the phone answers.
#   3. Saves everything in ~/Library/Application Support/TLU (no admin
#      password needed for that folder).
#   4. Asks for your Mac password once (sudo), needed to create the network
#      tunnel, like any VPN app. Then the window minimizes.
#   5. Control + C in this window stops it. If sing-box stops by itself, the
#      window comes back with a message.
#
# No other network calls, nothing is sent anywhere. Safe to run again.

set -u

# --- Pinned sing-box release and its SHA256 hashes (from the official release) ---
SB_VERSION="1.14.3"
SB_SHA256_ARM64="0360ce634a04c26a6b4fd957517987bb4f6c8950f63435ce3c5af2fcae5860c5"
SB_SHA256_AMD64="6d002b74d03b478547349cc10af89e007868596e5aa931816d45da9f544715a9"

APP_DIR="$HOME/Library/Application Support/TLU"
CONFIG_FILE="$APP_DIR/config.json"
SAVED_FILE="$APP_DIR/phone.txt"                 # last IP and port you entered
OLD_CONFIG="$HOME/Documents/sing-box.config"    # written by older versions of this script

SINGBOX_BIN=""
PHONE_IP=""
PHONE_PORT=""

say()  { printf '%s\n' "$*"; }
fail() {
  say ""
  say "$*"
  say ""
  exit 1
}

# --- sing-box: find, download, check, install ---

sb_arch() {
  case "$(uname -m)" in
    arm64)  echo "arm64" ;;
    x86_64) echo "amd64" ;;
    *)      echo "" ;;
  esac
}

sb_expected_hash() {
  case "$1" in
    arm64) echo "$SB_SHA256_ARM64" ;;
    amd64) echo "$SB_SHA256_AMD64" ;;
  esac
}

sb_name()    { echo "sing-box-$SB_VERSION-darwin-$1"; }
sb_url()     { echo "https://github.com/SagerNet/sing-box/releases/download/v$SB_VERSION/$(sb_name "$1").tar.gz"; }
our_binary() { echo "$APP_DIR/sing-box-$SB_VERSION/sing-box"; }

# Sets SINGBOX_BIN if a working sing-box is already here. Returns 1 if not.
find_singbox() {
  local ours
  ours="$(our_binary)"
  if [ -x "$ours" ]; then
    SINGBOX_BIN="$ours"
    return 0
  fi
  if command -v sing-box >/dev/null 2>&1; then
    SINGBOX_BIN="$(command -v sing-box)"
    return 0
  fi
  return 1
}

# Downloads, checks and installs sing-box. $1 = optional proxy (socks5h://IP:PORT).
install_singbox() {
  local proxy="${1:-}" arch expected tmp archive got
  arch="$(sb_arch)"
  if [ -z "$arch" ]; then
    fail "This Mac type is not supported (Apple silicon or Intel Mac needed)."
  fi
  expected="$(sb_expected_hash "$arch")"

  mkdir -p "$APP_DIR" || fail "Could not create the folder $APP_DIR"
  tmp="$(mktemp -d "$APP_DIR/download.XXXXXX")" || fail "Could not create a temporary folder in $APP_DIR"
  archive="$tmp/$(sb_name "$arch").tar.gz"

  local curl_args=(-fL -# --connect-timeout 10 --speed-limit 1000 --speed-time 30 -o "$archive")
  if [ -n "$proxy" ]; then
    curl_args+=(-x "$proxy")
  fi
  if ! curl "${curl_args[@]}" "$(sb_url "$arch")"; then
    rm -rf "$tmp"
    return 1
  fi

  got="$(shasum -a 256 "$archive" | awk '{print $1}')"
  if [ "$got" != "$expected" ]; then
    rm -rf "$tmp"
    fail "The downloaded file did not pass the safety check (SHA256 mismatch). Nothing was installed."
  fi
  say "Download checked (SHA256 OK)."

  if ! tar -xzf "$archive" -C "$tmp" || [ ! -f "$tmp/$(sb_name "$arch")/sing-box" ]; then
    rm -rf "$tmp"
    fail "Could not unpack sing-box. Run this script again."
  fi
  rm -rf "$APP_DIR/sing-box-$SB_VERSION"
  mkdir -p "$APP_DIR/sing-box-$SB_VERSION"
  mv "$tmp/$(sb_name "$arch")/sing-box" "$(our_binary)"
  chmod 755 "$(our_binary)"
  rm -rf "$tmp"
  SINGBOX_BIN="$(our_binary)"
  return 0
}

# --- IP and port ---

valid_ip() {
  local ip="$1" o
  if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
    return 1
  fi
  local IFS='.'
  for o in $ip; do
    if (( 10#$o > 255 )); then
      return 1
    fi
  done
  return 0
}

valid_port() {
  local port="$1"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 ))
}

# Prints "IP PORT" from the last run, if there is one.
saved_ip_port() {
  local ip="" port=""
  if [ -f "$SAVED_FILE" ]; then
    read -r ip port < "$SAVED_FILE"
  elif [ -f "$OLD_CONFIG" ]; then
    # The phone's IP and port are on the "socks" outbound line.
    local line
    line="$(grep '"type": *"socks"' "$OLD_CONFIG" | head -n 1)"
    ip="$(printf '%s' "$line" | sed -n 's/.*"server": *"\([0-9.]*\)".*/\1/p')"
    port="$(printf '%s' "$line" | sed -n 's/.*"server_port": *\([0-9]*\).*/\1/p')"
  fi
  if valid_ip "$ip" && valid_port "$port"; then
    echo "$ip $port"
  fi
}

prompt_for_ip_port() {
  local ip="" port=""
  while true; do
    read -rp "Phone IP address (shown in the app): " ip
    ip="$(echo "$ip" | tr -d '[:space:]')"
    if valid_ip "$ip"; then break; fi
    say "That IP doesn't look right. Type it exactly as the app shows it, for example 192.168.1.5"
  done
  while true; do
    read -rp "Port (shown in the app): " port
    port="$(echo "$port" | tr -d '[:space:]')"
    if valid_port "$port"; then break; fi
    say "That port doesn't look right. Type the number the app shows, for example 11111"
  done
  PHONE_IP="$ip"
  PHONE_PORT="$port"
}

ask_ip_port() {
  local saved confirm
  saved="$(saved_ip_port)"
  if [ -n "$saved" ]; then
    read -rp "Connect to ${saved% *}:${saved#* }? (y/n): " confirm
    if [[ "$confirm" =~ ^[yY]([eE][sS])?$ ]]; then
      PHONE_IP="${saved% *}"
      PHONE_PORT="${saved#* }"
      return
    fi
  fi
  prompt_for_ip_port
}

phone_answers() {
  nc -z -G 3 -w 3 "$1" "$2" >/dev/null 2>&1
}

# --- config ---

write_config() {
  mkdir -p "$APP_DIR" || fail "Could not create the folder $APP_DIR"
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
  printf '%s %s\n' "$PHONE_IP" "$PHONE_PORT" > "$SAVED_FILE"
}

# --- window ---

minimize_window() {
  case "${TERM_PROGRAM:-}" in
    Apple_Terminal)
      osascript -e 'tell application "Terminal" to set miniaturized of front window to true' 2>/dev/null
      ;;
    iTerm.app)
      osascript -e 'tell application "iTerm2" to tell current window to set miniaturized to true' 2>/dev/null
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

# --- main ---

main() {
  local need_download=0

  say ""
  say "Tether Link Utility: connect this Mac to your phone"
  say "---------------------------------------------------"

  # 1. sing-box, downloaded while this Mac still has its own internet.
  if ! find_singbox; then
    say "Downloading sing-box $SB_VERSION (about 30 MB, only the first time) ..."
    if install_singbox; then
      say "sing-box is ready."
      say ""
      say "Now join the phone's Wi-Fi and turn sharing on in the app (already done? fine)."
      read -rp "Press Return when this Mac is on the phone's Wi-Fi... " _
    else
      say "No internet right now. That's OK: it will download through the phone in a moment."
      need_download=1
    fi
  fi

  # 2. Phone IP and port.
  say ""
  say "Open TLU on your phone and tap START SHARING. It shows an IP and a port."
  ask_ip_port
  say "Checking $PHONE_IP:$PHONE_PORT ..."
  if ! phone_answers "$PHONE_IP" "$PHONE_PORT"; then
    fail "Can't reach your phone. Make sure this Mac is on the phone's Wi-Fi and sharing is on in the app, then run this script again."
  fi
  say "Phone found."

  if [ "$need_download" = 1 ]; then
    say "Downloading sing-box $SB_VERSION through the phone (about 30 MB) ..."
    if ! install_singbox "socks5h://$PHONE_IP:$PHONE_PORT"; then
      fail "Download failed. Check that sharing is on in the app and run this script again."
    fi
    say "sing-box is ready."
  fi

  # 3. Config.
  write_config
  if ! "$SINGBOX_BIN" check --config "$CONFIG_FILE" >/dev/null 2>&1; then
    fail "sing-box did not accept the settings in $CONFIG_FILE. Run this script again."
  fi

  # 4. Start.
  say ""
  say "Your Mac password is needed once, to create the network tunnel."
  say "Nothing appears while you type it. That's normal: type it and press Return."
  sudo -v || fail "The password was not accepted. Run this script again."
  # Keep the password fresh so Control + C can always stop sing-box.
  ( while sudo -n true 2>/dev/null; do sleep 50; done ) &
  KEEPALIVE_PID=$!

  # Safe to run again: stop a copy this script started before.
  sudo pkill -f "sing-box run --config $CONFIG_FILE" 2>/dev/null
  sudo pkill -f "sing-box run --config $OLD_CONFIG" 2>/dev/null
  sleep 1

  sudo "$SINGBOX_BIN" run --config "$CONFIG_FILE" &
  SINGBOX_PID=$!

  # shellcheck disable=SC2329  # called by the trap below
  cleanup() {
    say ""
    say "Stopping ..."
    sudo kill "$SINGBOX_PID" 2>/dev/null
    sudo pkill -f "sing-box run --config $CONFIG_FILE" 2>/dev/null
    kill "$KEEPALIVE_PID" 2>/dev/null
    say "Stopped. You can turn sharing off in the app now."
    exit 0
  }
  trap cleanup INT TERM HUP

  sleep 3
  if ! kill -0 "$SINGBOX_PID" 2>/dev/null; then
    kill "$KEEPALIVE_PID" 2>/dev/null
    fail "sing-box stopped right away. Check the IP and port in the app and run this script again."
  fi

  say ""
  say "Connected. Every app on this Mac now uses the phone's internet."
  say "To stop: open this window and press Control + C."
  say "Stop it here first, before you turn sharing off in the app."
  say "This window will minimize now."
  minimize_window

  # 5. Bring the window back if sing-box stops by itself.
  while kill -0 "$SINGBOX_PID" 2>/dev/null; do
    sleep 2
  done
  kill "$KEEPALIVE_PID" 2>/dev/null
  restore_window
  fail "sing-box stopped. Run this script again to reconnect."
}

# Run only when started as a script (tests can load the functions with "source").
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
