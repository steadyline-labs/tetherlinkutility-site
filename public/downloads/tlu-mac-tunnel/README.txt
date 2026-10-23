Tether Link Utility, Mac connection for every app
==================================================

What this does
--------------
The SOCKS proxy setting in macOS only covers apps that use it, and DNS
lookups don't go through it. This script runs sing-box
(https://github.com/SagerNet/sing-box, open source) in TUN mode instead, so
every app on your Mac, DNS included, uses your phone's internet.

Requirements
------------
- A Mac (Apple silicon or Intel).
- Nothing else. Homebrew is not needed. The first time, the script downloads
  sing-box 1.14.3 from its official GitHub page (about 30 MB) and checks it
  with a SHA256 hash. If your Mac has no internet of its own, it downloads
  it through the phone after you enter the IP and port.

How to use
----------
1. On your phone, open Tether Link Utility and tap START SHARING. Join the
   phone's Wi-Fi on your Mac (it may say "No internet", that's normal).
2. Press Command + Space, type Terminal, press Return.
3. Type this and press Return:
     cd ~/Downloads/tlu-mac-tunnel
4. Type this and press Return:
     bash tlu-mac-tunnel.sh
5. Type the IP address and port shown in the app.
   Next time it asks "Connect to IP:port? (y/n)". Type y and press Return
   to use the same ones, or n to type new ones.
6. Type your Mac password when asked and press Return. Nothing appears while
   you type it, that's normal.
7. When you see "Connected.", the window minimizes and the connection keeps
   running.

To stop: open the Terminal window again and press Control + C. Do this
before you turn sharing off in the app.

Where things are saved
----------------------
~/Library/Application Support/TLU (sing-box, config.json and the last IP
and port). The script sends nothing anywhere and is safe to run again.

More help:
https://tetherlinkutility.com/blog/socks5-proxy-setup-windows-macos-ios.html#macos
