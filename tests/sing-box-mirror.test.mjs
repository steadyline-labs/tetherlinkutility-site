// The sing-box copies in public/downloads/sing-box/<version>/ (second download location of the desktop scripts).
// Written by the release job of steadyline-labs/tlu-desktop-scripts from the official release, never by hand.
// Once a shipped script points at the copy, every file it may fetch must be here with the hash pinned in that
// script (the official release hash), with the GPL license and the source note next to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const base = path.join(root, "public/downloads/sing-box");
const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const EXTRA = ["COPYING", "LICENSE", "SHA256SUMS", "SOURCE.txt"];

// [script, os, archive extension, pattern for the version, pattern for the arm64 and amd64 hashes]
const SCRIPTS = [
  ["downloads/TLU-Windows-Setup.cmd", "windows", "zip", /^\$Version = '([\d.]+)'/m, (a) => new RegExp(`'${a}' = '([0-9a-f]{64})'`)],
  ["downloads/tlu-mac-tunnel/tlu-mac-tunnel.sh", "darwin", "tar.gz", /^SB_VERSION="([\d.]+)"/m, (a) => new RegExp(`^SB_SHA256_${a.toUpperCase()}="([0-9a-f]{64})"`, "m")],
  ["downloads/tlu-linux-tunnel.sh", "linux", "tar.gz", /^SB_VERSION="([\d.]+)"/m, (a) => new RegExp(`^SB_SHA256_${a.toUpperCase()}="([0-9a-f]{64})"`, "m")],
];

const sums = (dir) =>
  Object.fromEntries(
    fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => {
      const m = l.match(/^([0-9a-f]{64}) {2}(\S+)$/);
      assert.ok(m, `SHA256SUMS line: ${l}`);
      return [m[2], m[1]];
    }),
  );

const versions = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => !d.startsWith(".")) : [];

for (const v of versions) {
  test(`downloads/sing-box/${v}: every file matches SHA256SUMS, with LICENSE, COPYING and SOURCE.txt`, () => {
    const dir = path.join(base, v);
    const list = sums(dir);
    assert.deepEqual(fs.readdirSync(dir).sort(), [...Object.keys(list), ...EXTRA].sort(), "only the listed files");
    for (const [name, hash] of Object.entries(list)) {
      assert.match(name, new RegExp(`^sing-box-${v.replaceAll(".", "\\.")}-(windows|darwin|linux)-(amd64|arm64)\\.(zip|tar\\.gz)$`));
      assert.equal(sha256(path.join(dir, name)), hash, `${name}: sha256`);
    }
    assert.match(fs.readFileSync(path.join(dir, "LICENSE"), "utf8"), /GNU General Public License/);
    assert.match(fs.readFileSync(path.join(dir, "COPYING"), "utf8"), /GNU GENERAL PUBLIC LICENSE\s+Version 3/);
    const note = fs.readFileSync(path.join(dir, "SOURCE.txt"), "utf8");
    assert.ok(note.includes(`https://github.com/steadyline-labs/sing-box/tree/v${v}`), "source link to our fork");
    assert.ok(note.includes(`https://github.com/SagerNet/sing-box/releases/tag/v${v}`), "link to the official release");
  });
}

for (const [script, os, ext, versionRe, hashRe] of SCRIPTS) {
  test(`${script}: if it uses the sing-box copy, the copy has its files with the hashes it pins`, () => {
    const src = fs.readFileSync(path.join(root, "public", script), "utf8");
    if (!src.includes("https://tetherlinkutility.com/downloads/sing-box/")) return;
    const v = (src.match(versionRe) || [])[1];
    assert.ok(v, "sing-box version in the script");
    const dir = path.join(base, v);
    assert.ok(fs.existsSync(dir), `public/downloads/sing-box/${v} is missing`);
    const list = sums(dir);
    for (const arch of ["arm64", "amd64"]) {
      const pinned = (src.match(hashRe(arch)) || [])[1];
      const name = `sing-box-${v}-${os}-${arch}.${ext}`;
      assert.ok(pinned, `${arch} hash in the script`);
      assert.equal(list[name], pinned, `${name}: SHA256SUMS equals the script's pinned hash`);
      assert.equal(sha256(path.join(dir, name)), pinned, `${name}: file equals the script's pinned hash`);
    }
  });
}
