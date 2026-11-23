#!/bin/bash
# Tether Link Utility, Mac full-coverage tunnel helper.
#
# Wraps sing-box (https://github.com/SagerNet/sing-box) in TUN mode so the whole
# system's traffic, DNS included, routes through the phone's SOCKS5 proxy instead
# of just whatever apps check macOS's native SOCKS proxy setting. Runs as a
# LaunchDaemon so it survives closing the terminal, no need to keep a window open.
#
# Usage:
#   ./tlu-tunnel.sh start <phone-ip> <phone-port>
#   ./tlu-tunnel.sh stop
#   ./tlu-tunnel.sh status
#
# Requires: brew install sing-box

set -e

CONFIG_DIR="$HOME/.config/sing-box"
CONFIG_FILE="$CONFIG_DIR/tlu-tunnel.json"
PLIST_PATH="/Library/LaunchDaemons/com.tetherlinkutility.tunnel.plist"
LABEL="com.tetherlinkutility.tunnel"
LOG_FILE="/tmp/tlu-tunnel.log"
NET_STATE_FILE="$CONFIG_DIR/tlu-network-restore.txt"  # DNS and IPv6 settings to put back on stop
TUN_DNS="172.19.0.2"                            # inside the tunnel, so DNS is caught by it

SINGBOX_BIN="$(command -v sing-box || true)"
if [ -z "$SINGBOX_BIN" ] && [ -x /opt/homebrew/opt/sing-box/bin/sing-box ]; then
  SINGBOX_BIN="/opt/homebrew/opt/sing-box/bin/sing-box"
fi

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
  local svc="$1" dns v6
  dns="$(networksetup -getdnsservers "$svc" 2>/dev/null | grep -E '^[0-9a-fA-F:.]+$' | tr '\n' ' ')"
  v6="$(networksetup -getinfo "$svc" 2>/dev/null | sed -n 's/^IPv6: //p' | head -1)"
  printf '%s\n%s\n%s\n' "$svc" "${dns:-Empty}" "${v6:-Automatic}" > "$NET_STATE_FILE"
  sudo networksetup -setdnsservers "$svc" "$TUN_DNS"
  sudo networksetup -setv6off "$svc"
  flush_dns
}

# Puts the saved DNS and IPv6 settings back. Safe to call more than once.
restore_dns() {
  [ -f "$NET_STATE_FILE" ] || return 0
  local svc="" dns="" v6=""
  { read -r svc; read -r dns; read -r v6; } < "$NET_STATE_FILE"
  if [ -n "$svc" ]; then
    # shellcheck disable=SC2086  # several DNS servers, one per word
    sudo networksetup -setdnsservers "$svc" ${dns:-Empty}
    case "$v6" in
      Off) ;;
      Link*) sudo networksetup -setv6LinkLocal "$svc" ;;
      *) sudo networksetup -setv6automatic "$svc" ;;
    esac
  fi
  rm -f "$NET_STATE_FILE"
  flush_dns
}

usage() {
  echo "Usage: $0 start <phone-ip> <phone-port> | stop | status"
  exit 1
}

write_config() {
  local ip="$1" port="$2"
  mkdir -p "$CONFIG_DIR"
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
    { "type": "socks", "tag": "phone-socks5", "server": "$ip", "server_port": $port, "version": "5" },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [
      { "port": 53, "action": "hijack-dns" },
      { "ip_cidr": ["$ip/32"], "outbound": "direct" },
      { "ip_version": 6, "action": "reject", "no_drop": true }
    ],
    "final": "phone-socks5",
    "auto_detect_interface": true,
    "default_domain_resolver": "remote"
  }
}
EOF
}

write_plist() {
  sudo tee "$PLIST_PATH" > /dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$SINGBOX_BIN</string>
        <string>run</string>
        <string>--config</string>
        <string>$CONFIG_FILE</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>
</dict>
</plist>
EOF
  sudo chown root:wheel "$PLIST_PATH"
  sudo chmod 644 "$PLIST_PATH"
}

case "$1" in
  start)
    if [ -z "$2" ] || [ -z "$3" ]; then usage; fi
    if [ -z "$SINGBOX_BIN" ]; then
      echo "sing-box not found. Install it first (on your normal internet, BEFORE joining the phone's Wi-Fi): brew install sing-box"
      exit 1
    fi
    write_config "$2" "$3"
    write_plist
    sudo launchctl bootout system "$PLIST_PATH" 2>/dev/null || true
    restore_dns   # left over from an earlier start
    SERVICE="$(active_service)"
    trap 'restore_dns' ERR
    sudo launchctl bootstrap system "$PLIST_PATH"
    sleep 2
    if [ -n "$SERVICE" ]; then
      set_tunnel_dns "$SERVICE"
    fi
    trap - ERR
    echo "Tunnel started. Phone: $2:$3"
    echo "It keeps running in the background, closing this terminal window won't stop it."
    echo "Logs: $LOG_FILE"
    ;;
  stop)
    sudo launchctl bootout system "$PLIST_PATH" 2>/dev/null || true
    sudo rm -f "$PLIST_PATH"
    restore_dns
    echo "Tunnel stopped."
    ;;
  status)
    sudo launchctl print "system/$LABEL" 2>/dev/null | head -25 || echo "Not running."
    ;;
  *)
    usage
    ;;
esac
