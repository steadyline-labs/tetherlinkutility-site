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

SINGBOX_BIN="$(command -v sing-box || true)"
if [ -z "$SINGBOX_BIN" ] && [ -x /opt/homebrew/opt/sing-box/bin/sing-box ]; then
  SINGBOX_BIN="/opt/homebrew/opt/sing-box/bin/sing-box"
fi

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
    { "type": "socks", "tag": "phone-socks5", "server": "$ip", "server_port": $port, "version": "5" },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [ { "ip_cidr": ["$ip/32"], "outbound": "direct" } ],
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
    sudo launchctl bootstrap system "$PLIST_PATH"
    echo "Tunnel started. Phone: $2:$3"
    echo "It keeps running in the background, closing this terminal window won't stop it."
    echo "Logs: $LOG_FILE"
    ;;
  stop)
    sudo launchctl bootout system "$PLIST_PATH" 2>/dev/null || true
    sudo rm -f "$PLIST_PATH"
    echo "Tunnel stopped."
    ;;
  status)
    sudo launchctl print "system/$LABEL" 2>/dev/null | head -25 || echo "Not running."
    ;;
  *)
    usage
    ;;
esac
