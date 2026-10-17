// Minimal headless Chrome driver over the DevTools protocol (no extra packages; uses the
// built-in WebSocket of Node 22+). Serves _site/ on 127.0.0.1 and blocks every request that
// leaves it. Formspree requests are answered by the test, so nothing is ever really sent.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { siteDir } from "./site.mjs";

export const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const hasChrome = () => fs.existsSync(CHROME) && typeof WebSocket === "function";

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain", ".mp4": "video/mp4" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(siteDir, p);
    if (!f.startsWith(siteDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export async function launch() {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tlu-site-test-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync",
    // Belt and braces: a dead proxy for everything except 127.0.0.1, so no request can leave the machine.
    "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=127.0.0.1",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });

  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const [port, wsPath] = fs.readFileSync(portFile, "utf8").trim().split("\n");
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) for (const fn of listeners) fn(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  async function newPage({ javaScript = true } = {}) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const page = {
      requests: [],      // Formspree requests: { method, url, body }
      replies: [],       // planned answers for Formspree POSTs: a status code or "network"
      errors: [],        // uncaught page exceptions
      blocked: [],       // other outside requests that were blocked
    };
    let loaded = null;
    const onEvent = async (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Page.loadEventFired" && loaded) loaded();
      if (msg.method === "Runtime.exceptionThrown") page.errors.push(msg.params.exceptionDetails);
      if (msg.method !== "Fetch.requestPaused") return;
      const { requestId, request } = msg.params;
      const cors = [
        { name: "Access-Control-Allow-Origin", value: "*" },
        { name: "Access-Control-Allow-Headers", value: "Accept, Content-Type" },
        { name: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
        { name: "Content-Type", value: "application/json" },
      ];
      if (request.url.startsWith(origin)) return send("Fetch.continueRequest", { requestId }, sessionId);
      if (request.url.startsWith("https://formspree.io/")) {
        if (request.method === "OPTIONS") return send("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders: cors }, sessionId);
        page.requests.push({ method: request.method, url: request.url, headers: request.headers, body: request.postData });
        const reply = page.replies.length > 1 ? page.replies.shift() : page.replies[0] ?? 200;
        if (reply === "network") return send("Fetch.failRequest", { requestId, errorReason: "Failed" }, sessionId);
        return send("Fetch.fulfillRequest", {
          requestId, responseCode: reply, responseHeaders: cors,
          body: Buffer.from(JSON.stringify(reply < 300 ? { ok: true } : { error: "mock" })).toString("base64"),
        }, sessionId);
      }
      page.blocked.push(request.url);
      return send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId);
    };
    listeners.add(onEvent);
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
    if (!javaScript) await send("Emulation.setScriptExecutionDisabled", { value: true }, sessionId);

    page.goto = async (urlPath) => {
      const done = new Promise((r) => (loaded = r));
      await send("Page.navigate", { url: origin + urlPath }, sessionId);
      await done;
    };
    page.eval = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    };
    page.waitFor = async (expression, timeout = 8000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await page.eval(expression)) return true; } catch { /* page is navigating */ }
        await sleep(50);
      }
      throw new Error(`timed out waiting for: ${expression}`);
    };
    page.close = async () => {
      listeners.delete(onEvent);
      await send("Target.closeTarget", { targetId });
    };
    return page;
  }

  async function close() {
    try { await send("Browser.close"); } catch { /* already gone */ }
    ws.close();
    if (chrome.exitCode === null) {
      const exited = new Promise((r) => chrome.once("exit", r));
      chrome.kill();
      await exited;
    }
    server.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  return { origin, newPage, close };
}
