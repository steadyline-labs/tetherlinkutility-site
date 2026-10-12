Tether Link Utility, Mac Full-Coverage Tunnel
==============================================

What this does
--------------
A per-app or system SOCKS5 proxy setting on macOS only routes traffic from
apps that check it. DNS lookups and background app traffic can still go
over the plain hotspot connection instead of through the proxy.

This script wraps sing-box (https://github.com/SagerNet/sing-box, an open
source project) in TUN mode instead, so your whole Mac's traffic, DNS
included, routes through your phone's SOCKS5 proxy.

Requirements
------------
- macOS
- Homebrew (https://brew.sh). The script installs sing-box itself if it's
  missing, but Homebrew has to already be there.

How to use
----------
1. Open Terminal, cd into the folder you unzipped this into.
2. Run: chmod +x tlu-mac-tunnel.sh
3. Run: ./tlu-mac-tunnel.sh
4. Enter the IP address and port shown in the Tether Link Utility app on your
   phone (tap START SERVER first to see them).
5. Enter your Mac's admin password once when asked (sudo), it's needed to
   create the network tunnel and change routing, same as any VPN app.
6. The Terminal window minimizes and the tunnel keeps running in the
   background. Bring the window back and press Ctrl+C to stop it (this also
   stops sing-box).

Your settings are remembered in ~/Documents/sing-box.config for next time,
you'll just be asked to confirm the same IP/port instead of retyping it.

More detail and the full config format:
https://tetherlinkutility.com/blog/socks5-proxy-setup-windows-macos-ios.html
