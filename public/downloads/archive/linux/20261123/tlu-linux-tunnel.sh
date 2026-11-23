#!/bin/bash
# Tether Link Utility (TLU), Linux connection for every app.
# https://tetherlinkutility.com
#
# Runs sing-box (https://github.com/SagerNet/sing-box, open source) in TUN
# mode, so every app on this computer, DNS included, uses the phone's
# internet through the TLU app.
#
# What it does:
#   1. Finds sing-box: our own copy, or one you already installed.
#      Otherwise it downloads sing-box 1.14.3 once from its official GitHub
#      releases page while this computer still has its own internet, and
#      checks its SHA256 hash. If that download fails, it tries again
#      through the phone after you enter the IP and port.
#   2. Asks for the IP and port shown in the TLU app (or offers the last
#      ones, or takes them as "bash tlu-linux-tunnel.sh IP:PORT"), and
#      checks that the phone answers.
#   3. Saves everything in ~/.local/share/tlu.
#   4. Asks for your password once (sudo), needed to create the network
#      tunnel, like any VPN app.
#   5. While connected, DNS points inside the tunnel and IPv6 is off on the
#      active network, so nothing slips past the phone. Both are put back on
#      stop, or on the next run if the script was cut off.
#   6. Control + C in this window stops it.
#
# The only other network call: it reads our small version file
# (tetherlinkutility.com/downloads/desktop-versions.txt) and, when a newer
# script exists, offers to update itself. Nothing is sent anywhere.
# Safe to run again.

set -u

# --- This script's version (desktop-versions.txt "linux=" on the site) ---
SCRIPT_VERSION=20261123
SCRIPT_URL="${TLU_SCRIPT_URL:-https://tetherlinkutility.com/downloads/tlu-linux-tunnel.sh}"
VERSIONS_URL="${TLU_VERSIONS_URL:-https://tetherlinkutility.com/downloads/desktop-versions.txt}"
UPDATE_CHECKED=0

# --- Pinned sing-box release and its SHA256 hashes (from the official release) ---
SB_VERSION="1.14.3"
SB_SHA256_ARM64="29dae24d76bea3bc62d07dd3e60cfc12003de7debbd6b768df9be9c68360174e"
SB_SHA256_AMD64="e2bdf179c15a3652955dc44867e33ca0965c9c9b91b34267dcc5a5d639a5feee"

APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/tlu"
CONFIG_FILE="$APP_DIR/config.json"
SAVED_FILE="$APP_DIR/phone.txt"                 # last IP and port you entered
NET_STATE_FILE="$APP_DIR/network-restore.txt"   # DNS and IPv6 settings to put back on stop
RESOLV_SAVED="$APP_DIR/resolv.conf.saved"       # copy of /etc/resolv.conf from before
RESOLV_CONF="${TLU_RESOLV_CONF:-/etc/resolv.conf}"
TUN_NAME="tlu0"
TUN_DNS="172.19.0.2"                            # inside the tunnel, so DNS is caught by it
TUN_TABLE=2022                                  # sing-box routing table and its rules (9000 and up)
TUN_RULE_INDEX=9000
SOURCE_RULE_PREF=9004                           # our rule after sing-box's, see keep_sources_in_tunnel

SINGBOX_BIN=""
PHONE_IP=""
PHONE_PORT=""
SINGBOX_PID=""
KEEPALIVE_PID=""
SCRIPT_ARGS=()

if [ "$(id -u)" = 0 ]; then SUDO=""; else SUDO="sudo"; fi

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
    x86_64|amd64)  echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)             echo "" ;;
  esac
}

sb_expected_hash() {
  case "$1" in
    arm64) echo "$SB_SHA256_ARM64" ;;
    amd64) echo "$SB_SHA256_AMD64" ;;
  esac
}

sb_name()    { echo "sing-box-$SB_VERSION-linux-$1"; }
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
    fail "This computer type is not supported (64-bit Intel/AMD or ARM needed)."
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

  got="$(sha256sum "$archive" | awk '{print $1}')"
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

# --- self update ---

# Newest Linux script version on the site, or nothing (offline, slow, odd answer).
latest_version() {
  local proxy="${1:-}" args=(-fsS --connect-timeout 4 --max-time 8)
  [ -n "$proxy" ] && args+=(-x "$proxy")
  curl "${args[@]}" "$VERSIONS_URL" 2>/dev/null | tr -d '\r' | sed -n 's/^linux=\([0-9][0-9]*\)$/\1/p' | head -1
}

# Offers a newer script once per run; on yes it replaces this file and starts it again.
# Never stops the connection: any problem just keeps this version.
check_update() {
  local proxy="${1:-}" latest answer tmp self
  latest="$(latest_version "$proxy")"
  [ -n "$latest" ] || return 0
  UPDATE_CHECKED=1
  [ "$latest" -gt "$SCRIPT_VERSION" ] 2>/dev/null || return 0
  say ""
  say "A newer version of this script is available."
  read -rp "Update now? (y/n): " answer
  case "$answer" in y|Y|yes|YES) ;; *) say "OK, continuing with this version."; return 0 ;; esac
  self="${BASH_SOURCE[0]}"
  tmp="$(mktemp "${TMPDIR:-/tmp}/tlu-linux-tunnel.XXXXXX")" || return 0
  local args=(-fsSL --connect-timeout 10 --max-time 60 -o "$tmp")
  [ -n "$proxy" ] && args+=(-x "$proxy")
  if curl "${args[@]}" "$SCRIPT_URL" && head -1 "$tmp" | grep -q '^#!/bin/bash' \
     && grep -q "^SCRIPT_VERSION=$latest\$" "$tmp" && bash -n "$tmp" && cat "$tmp" > "$self"; then
    rm -f "$tmp"
    say "Updated. Starting the new version ..."
    exec bash "$self" "${SCRIPT_ARGS[@]}"
  fi
  rm -f "$tmp"
  say "Could not update right now, continuing with this version."
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
  fi
  if valid_ip "$ip" && valid_port "$port"; then
    echo "$ip $port"
  fi
}

prompt_for_ip_port() {
  local ip="" port=""
  while true; do
    read -rp "Phone IP address (shown in the app): " ip || fail "No IP entered."
    ip="$(echo "$ip" | tr -d '[:space:]')"
    if valid_ip "$ip"; then break; fi
    say "That IP doesn't look right. Type it exactly as the app shows it, for example 192.168.1.5"
  done
  while true; do
    read -rp "Port (shown in the app): " port || fail "No port entered."
    port="$(echo "$port" | tr -d '[:space:]')"
    if valid_port "$port"; then break; fi
    say "That port doesn't look right. Type the number the app shows, for example 11111"
  done
  PHONE_IP="$ip"
  PHONE_PORT="$port"
}

# $1 = optional "IP:PORT" from the command line.
ask_ip_port() {
  local arg="${1:-}" saved confirm
  if [ -n "$arg" ]; then
    if valid_ip "${arg%:*}" && valid_port "${arg##*:}"; then
      PHONE_IP="${arg%:*}"
      PHONE_PORT="${arg##*:}"
      return
    fi
    say "\"$arg\" doesn't look like IP:port (for example 192.168.1.5:11111)."
  fi
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
  timeout 4 bash -c "exec 3<>/dev/tcp/$1/$2" >/dev/null 2>&1
}

# --- config ---

# IPv6 address for the tunnel, unless IPv6 is switched off on this computer.
tun_addresses() {
  if [ "$(cat /proc/sys/net/ipv6/conf/default/disable_ipv6 2>/dev/null || echo 1)" = 0 ]; then
    echo '"172.19.0.1/30", "fdfe:dcba:9876::1/126"'
  else
    echo '"172.19.0.1/30"'
  fi
}

write_config() {
  mkdir -p "$APP_DIR" || fail "Could not create the folder $APP_DIR"
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
    { "type": "tun", "tag": "tun-in", "interface_name": "$TUN_NAME", "address": [$(tun_addresses)], "mtu": 1500,
      "auto_route": true, "strict_route": true, "stack": "gvisor",
      "iproute2_table_index": $TUN_TABLE, "iproute2_rule_index": $TUN_RULE_INDEX }
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
  printf '%s %s\n' "$PHONE_IP" "$PHONE_PORT" > "$SAVED_FILE"
}

# --- DNS and IPv6 while connected ---
# The phone is often this computer's DNS server and sits on the same Wi-Fi,
# so DNS (and IPv6) could skip the tunnel and count as hotspot traffic.
# While connected, DNS points inside the tunnel and IPv6 is off on the active
# network; both are put back on stop. The state file makes this survive a
# cut-off run: the next run puts things back first.

# Interface behind the default route (for example wlan0).
active_interface() {
  ip route show default 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit }}'
}

# True when /etc/resolv.conf sends lookups to systemd-resolved.
uses_resolved() {
  command -v resolvectl >/dev/null 2>&1 || return 1
  resolvectl status >/dev/null 2>&1 || return 1
  grep -qE '^nameserver[[:space:]]+127\.0\.0\.5[34]' "$RESOLV_CONF" 2>/dev/null
}

flush_dns() {
  if command -v resolvectl >/dev/null 2>&1; then
    $SUDO resolvectl flush-caches 2>/dev/null || true
  fi
}

# $1 = active interface. Saves the current DNS and IPv6 settings to the state file.
# If the file is still there, an earlier restore did not finish: it holds the
# original settings and the computer still has the tunnel ones. Never save over it.
save_network_state() {
  local dev="$1" v6="" mode="none" target=""
  [ -f "$NET_STATE_FILE" ] && return 0
  if [ -n "$dev" ] && [ -f "/proc/sys/net/ipv6/conf/$dev/disable_ipv6" ]; then
    v6="$(cat "/proc/sys/net/ipv6/conf/$dev/disable_ipv6")"
  fi
  if uses_resolved; then
    mode="resolved"
  elif [ -L "$RESOLV_CONF" ]; then
    mode="symlink"
    target="$(readlink "$RESOLV_CONF")"
  elif [ -f "$RESOLV_CONF" ]; then
    mode="file"
    cp "$RESOLV_CONF" "$RESOLV_SAVED" || mode="none"
  fi
  printf '%s\n%s\n%s\n%s\n' "$dev" "$v6" "$mode" "$target" > "$NET_STATE_FILE"
}

# Points DNS into the tunnel and turns IPv6 off on the active interface (uses the state file).
set_tunnel_network() {
  local dev="" v6="" mode="" target=""
  { read -r dev; read -r v6; read -r mode; read -r target; } < "$NET_STATE_FILE"
  case "$mode" in
    resolved)
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        ip link show "$TUN_NAME" >/dev/null 2>&1 && break
        sleep 0.5
      done
      $SUDO resolvectl dns "$TUN_NAME" "$TUN_DNS"
      $SUDO resolvectl domain "$TUN_NAME" "~."
      $SUDO resolvectl default-route "$TUN_NAME" true 2>/dev/null || true
      ;;
    symlink)
      $SUDO rm -f "$RESOLV_CONF"
      write_tunnel_resolv
      ;;
    file)
      write_tunnel_resolv
      ;;
  esac
  if [ -n "$dev" ] && [ "$v6" = 0 ]; then
    echo 1 | $SUDO tee "/proc/sys/net/ipv6/conf/$dev/disable_ipv6" >/dev/null
  fi
  flush_dns
  keep_sources_in_tunnel "$dev"
}

# sing-box sends programs that pick no source address into the tunnel, but a
# program that sends from the Wi-Fi address itself (video calls, games and
# some downloaders do) would still go out over the Wi-Fi, past the phone app.
# One more rule sends that traffic into the tunnel too. The local network keeps
# working (sing-box's own rule before it), and sing-box's own connection to the
# phone is tied to the Wi-Fi interface, so it is not caught by this rule.
# $1 = active interface.
keep_sources_in_tunnel() {
  local dev="$1" a
  [ -n "$dev" ] || return 0
  for a in $(ip -4 -o addr show dev "$dev" 2>/dev/null | awk '{print $4}' | cut -d/ -f1); do
    $SUDO ip rule add pref "$SOURCE_RULE_PREF" from "$a" iif lo lookup "$TUN_TABLE" 2>/dev/null || true
  done
}

# Removes the rules above (also ones left by a run that was cut off).
drop_source_rules() {
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    ip rule list pref "$SOURCE_RULE_PREF" 2>/dev/null | grep -q "lookup $TUN_TABLE" || return 0
    $SUDO ip rule del pref "$SOURCE_RULE_PREF" lookup "$TUN_TABLE" 2>/dev/null || return 0
  done
}

write_tunnel_resolv() {
  printf '# Set by Tether Link Utility while connected, put back on stop.\nnameserver %s\n' "$TUN_DNS" \
    | $SUDO tee "$RESOLV_CONF" >/dev/null
}

# Some network managers rewrite /etc/resolv.conf; point it back into the tunnel.
keep_tunnel_resolv() {
  local mode
  mode="$(sed -n 3p "$NET_STATE_FILE" 2>/dev/null)"
  case "$mode" in
    file|symlink)
      if [ -L "$RESOLV_CONF" ] || ! grep -q "^nameserver $TUN_DNS\$" "$RESOLV_CONF" 2>/dev/null; then
        [ -L "$RESOLV_CONF" ] && $SUDO rm -f "$RESOLV_CONF"
        write_tunnel_resolv
      fi
      ;;
  esac
}

# Puts the saved DNS and IPv6 settings back. Safe to call more than once.
# The state file is kept (and 1 returned) unless every setting went back, so
# the next stop or the next run tries again with the original settings.
restore_network() {
  drop_source_rules
  [ -f "$NET_STATE_FILE" ] || return 0
  local dev="" v6="" mode="" target="" ok=1
  { read -r dev; read -r v6; read -r mode; read -r target; } < "$NET_STATE_FILE" || true
  case "$mode" in
    resolved)
      # The tunnel's DNS goes away with the tunnel; revert it if it is still up.
      if ip link show "$TUN_NAME" >/dev/null 2>&1; then
        $SUDO resolvectl revert "$TUN_NAME" 2>/dev/null || ok=0
      fi
      ;;
    symlink)
      if [ -n "$target" ]; then
        { $SUDO rm -f "$RESOLV_CONF" && $SUDO ln -sfn "$target" "$RESOLV_CONF"; } || ok=0
      fi
      ;;
    file)
      # Written in place, so a bind-mounted or watched file stays the same file.
      if [ -f "$RESOLV_SAVED" ]; then
        $SUDO tee "$RESOLV_CONF" < "$RESOLV_SAVED" >/dev/null || ok=0
      fi
      ;;
  esac
  if [ -n "$dev" ] && [ -n "$v6" ] && [ -f "/proc/sys/net/ipv6/conf/$dev/disable_ipv6" ]; then
    echo "$v6" | $SUDO tee "/proc/sys/net/ipv6/conf/$dev/disable_ipv6" >/dev/null || ok=0
  fi
  flush_dns
  [ "$ok" = 1 ] || return 1
  rm -f "$NET_STATE_FILE" "$RESOLV_SAVED"
}

NOT_RESTORED="Your DNS and IPv6 settings could not be put back yet. Run this script again and it puts them back first."

stop_singbox() {
  $SUDO pkill -f "sing-box run --config $CONFIG_FILE" 2>/dev/null
}

# --- main ---

need_tools() {
  local t missing=""
  for t in curl tar sha256sum ip timeout; do
    command -v "$t" >/dev/null 2>&1 || missing="$missing $t"
  done
  [ -n "$SUDO" ] && ! command -v sudo >/dev/null 2>&1 && missing="$missing sudo"
  [ -z "$missing" ] || fail "Please install these first, then run this script again:$missing"
}

main() {
  local need_download=0 arg="${1:-}"

  say ""
  say "Tether Link Utility: connect this computer to your phone"
  say "--------------------------------------------------------"
  need_tools

  # A run that was cut off left DNS and IPv6 changed: put them back first.
  if [ -f "$NET_STATE_FILE" ]; then
    say "Putting back the network settings from the last run (your password may be needed) ..."
    stop_singbox
    sleep 1
    restore_network || fail "$NOT_RESTORED"
    say "Done."
  fi

  # 0. A newer script? Checked while this computer still has its own internet, else through the phone below.
  check_update

  # 1. sing-box, downloaded while this computer still has its own internet.
  if ! find_singbox; then
    say "Downloading sing-box $SB_VERSION (about 30 MB, only the first time) ..."
    if install_singbox; then
      say "sing-box is ready."
      say ""
      say "Now join the phone's Wi-Fi and turn sharing on in the app (already done? fine)."
      read -rp "Press Enter when this computer is on the phone's Wi-Fi... " _
    else
      say "No internet right now. That's OK: it will download through the phone in a moment."
      need_download=1
    fi
  fi

  # 2. Phone IP and port.
  say ""
  say "Open TLU on your phone and tap START SHARING. It shows an IP and a port."
  ask_ip_port "$arg"
  say "Checking $PHONE_IP:$PHONE_PORT ..."
  if ! phone_answers "$PHONE_IP" "$PHONE_PORT"; then
    fail "Can't reach your phone. Make sure this computer is on the phone's Wi-Fi and sharing is on in the app, then run this script again."
  fi
  say "Phone found."
  [ "$UPDATE_CHECKED" = 1 ] || check_update "socks5h://$PHONE_IP:$PHONE_PORT"

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
  if [ -n "$SUDO" ]; then
    say ""
    say "Your password is needed once, to create the network tunnel."
    say "Nothing appears while you type it. That's normal: type it and press Enter."
    sudo -v || fail "The password was not accepted. Run this script again."
    # Keep the password fresh so Control + C can always stop sing-box and put DNS back.
    ( while sudo -n true 2>/dev/null; do sleep 50; done ) &
    KEEPALIVE_PID=$!
  fi

  # Safe to run again: stop a copy this script started before.
  stop_singbox
  sleep 1
  restore_network
  local dev
  dev="$(active_interface)"

  # shellcheck disable=SC2329  # called by the traps below
  cleanup() {
    trap - INT TERM HUP
    say ""
    say "Stopping ..."
    [ -n "$SINGBOX_PID" ] && $SUDO kill "$SINGBOX_PID" 2>/dev/null
    stop_singbox
    if restore_network; then
      say "Stopped. DNS and IPv6 are back to normal. You can turn sharing off in the app now."
    else
      say "Stopped. $NOT_RESTORED"
    fi
    [ -n "$KEEPALIVE_PID" ] && kill "$KEEPALIVE_PID" 2>/dev/null
    exit 0
  }
  trap cleanup INT TERM HUP
  trap restore_network EXIT

  save_network_state "$dev"
  $SUDO "$SINGBOX_BIN" run --config "$CONFIG_FILE" > "$APP_DIR/sing-box.log" 2>&1 &
  SINGBOX_PID=$!

  sleep 3
  if ! kill -0 "$SINGBOX_PID" 2>/dev/null; then
    restore_network
    [ -n "$KEEPALIVE_PID" ] && kill "$KEEPALIVE_PID" 2>/dev/null
    fail "sing-box stopped right away (details in $APP_DIR/sing-box.log). Check the IP and port in the app and run this script again."
  fi
  set_tunnel_network

  say ""
  say "Connected. Every app on this computer now uses the phone's internet."
  say "To stop: press Control + C in this window."
  say "Stop it here first, before you turn sharing off in the app."

  # 5. Watch sing-box; tell the user if it stops by itself.
  while kill -0 "$SINGBOX_PID" 2>/dev/null; do
    sleep 2
    keep_tunnel_resolv
  done
  restore_network
  [ -n "$KEEPALIVE_PID" ] && kill "$KEEPALIVE_PID" 2>/dev/null
  fail "sing-box stopped (details in $APP_DIR/sing-box.log). Run this script again to reconnect."
}

# Run only when started as a script (tests can load the functions with "source").
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  SCRIPT_ARGS=("$@")
  main "$@"
fi
