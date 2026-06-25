import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const MEDIA_DIR = path.join(ROOT, "media");
const GEN_DIR = path.join(MEDIA_DIR, "generated");
const DIST_DIR = path.join(ROOT, "dist");
const REG_FILE = path.join(ROOT, "devices.json");
const PORT = process.env.PORT || 3001;

fs.mkdirSync(GEN_DIR, { recursive: true });

// ---- TTS config ----------------------------------------------------------
function loadTtsConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "tts.config.json"), "utf8"));
  } catch {
    return { piperPath: "piper", voices: {} };
  }
}
const voicePath = (p) =>
  !p ? null : path.isAbsolute(p) ? p : path.join(ROOT, p);

// piperPath may be a bare command on PATH ("piper"), a relative path with a
// slash (resolved from the project root), or an absolute path.
const resolvePiper = (p) =>
  !p
    ? "piper"
    : path.isAbsolute(p) || !p.includes("/")
      ? p
      : path.join(ROOT, p);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---- Content (read fresh each request) -----------------------------------
const readJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));

app.get("/api/schedule", (_req, res) => {
  try {
    res.json(readJson("schedule.json"));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.get("/api/announcements", (_req, res) => {
  try {
    res.json(readJson("announcements.json"));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const writeJson = (name, obj) =>
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(obj, null, 2));

// Editing from the control panel persists back to the JSON files.
app.post("/api/schedule", (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.events)) {
    return res.status(400).json({ error: "invalid schedule" });
  }
  try {
    writeJson("schedule.json", body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/announcements", (req, res) => {
  const list = Array.isArray(req.body) ? req.body : req.body?.announcements;
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: "invalid announcements" });
  }
  try {
    writeJson("announcements.json", { announcements: list });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Offline TTS via Piper -----------------------------------------------
app.get("/api/tts/health", (_req, res) => {
  const cfg = loadTtsConfig();
  const langs = Object.keys(cfg.voices || {});
  const missing = langs.filter((l) => {
    const vp = voicePath(cfg.voices[l]);
    return !vp || !fs.existsSync(vp);
  });
  const ready = langs.length > 0 && missing.length < langs.length;
  let detail = ready
    ? `voices: ${langs.filter((l) => !missing.includes(l)).join(", ")}`
    : "no voice models found";
  if (missing.length) detail += ` (missing: ${missing.join(", ")})`;
  res.json({ ready, detail });
});

app.post("/api/tts", async (req, res) => {
  const { text, lang } = req.body || {};
  if (!text || !lang) return res.status(400).json({ error: "text and lang required" });
  const cfg = loadTtsConfig();
  const model = voicePath(cfg.voices?.[lang]);
  if (!model || !fs.existsSync(model)) {
    return res.status(503).json({
      error: `no Piper voice configured for "${lang}" (see tts.config.json)`,
    });
  }
  const hash = createHash("sha1").update(`${lang}:${text}`).digest("hex").slice(0, 16);
  const fileName = `${lang}-${hash}.wav`;
  const outPath = path.join(GEN_DIR, fileName);
  const url = `/audio/generated/${fileName}`;
  if (fs.existsSync(outPath)) return res.json({ ok: true, url });
  try {
    await runPiper(resolvePiper(cfg.piperPath), model, text, outPath);
    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ error: `Piper failed: ${String(e)}` });
  }
});

function runPiper(piperPath, model, text, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(piperPath, ["--model", model, "--output_file", outPath]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) =>
      reject(err.code === "ENOENT" ? `binary not found at "${piperPath}"` : err),
    );
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outPath)) resolve();
      else reject(stderr || `exit code ${code}`);
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

// ---- Static --------------------------------------------------------------
app.use("/audio", express.static(MEDIA_DIR));
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/(api|audio|ws)).*/, (_req, res) =>
    res.sendFile(path.join(DIST_DIR, "index.html")),
  );
}

// ---- Device registry (persisted) -----------------------------------------
// Remembers known devices by id so an approved phone stays approved across
// reconnects. Admin = any client connecting from the laptop itself (loopback).
function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveRegistry() {
  try {
    fs.writeFileSync(REG_FILE, JSON.stringify(registry, null, 2));
  } catch {
    /* best effort */
  }
}
const registry = loadRegistry();

const normalizeIp = (ip) => (ip || "").replace(/^::ffff:/, "");
const isLoopback = (ip) => {
  const n = normalizeIp(ip);
  return n === "127.0.0.1" || n === "::1" || n === "localhost";
};

function lanUrls() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) {
        out.push(`http://${ni.address}:${PORT}/control`);
      }
    }
  }
  return out;
}

const clients = new Set(); // { ws, id, role, name, admin, approved, ip }

function roster() {
  const byId = new Map();
  // persisted (possibly offline) first
  for (const [id, r] of Object.entries(registry)) {
    byId.set(id, {
      id,
      role: r.role || "control",
      name: r.name || "Device",
      admin: false,
      approved: !!r.approved,
      connected: false,
      ip: r.ip,
    });
  }
  // overlay live clients
  for (const c of clients) {
    if (!c.id) continue;
    byId.set(c.id, {
      id: c.id,
      role: c.role,
      name: c.name,
      admin: c.admin,
      approved: c.approved,
      connected: true,
      ip: c.ip,
    });
  }
  return [...byId.values()];
}

const send = (ws, obj) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

function stateFor(c) {
  return {
    kind: "state",
    me: c.id
      ? {
          id: c.id,
          role: c.role,
          name: c.name,
          admin: c.admin,
          approved: c.approved,
          connected: true,
        }
      : null,
    devices: roster(),
    serverUrls: lanUrls(),
  };
}

function broadcastState() {
  for (const c of clients) send(c.ws, stateFor(c));
}

function relayBus(from, msg) {
  for (const c of clients) {
    if (c === from) continue;
    send(c.ws, { kind: "bus", msg });
  }
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws, req) => {
  const ip = normalizeIp(req.socket.remoteAddress);
  const client = {
    ws,
    id: null,
    role: "control",
    name: "Device",
    admin: isLoopback(ip),
    approved: isLoopback(ip),
    ip,
  };
  clients.add(client);

  ws.on("message", (data) => {
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (m.kind === "hello") {
      client.id = String(m.deviceId || "");
      client.role = m.role === "display" ? "display" : "control";
      const reg = registry[client.id];
      client.name =
        reg?.name || m.name || (client.role === "display" ? "TV display" : "Device");
      client.approved = client.admin ? true : reg?.approved ?? false;
      registry[client.id] = {
        name: client.name,
        role: client.role,
        approved: client.approved,
        ip: client.ip,
        lastSeen: Date.now(),
      };
      saveRegistry();
      broadcastState();
    } else if (m.kind === "bus") {
      // Only approved controls may drive the screen; displays may always reply.
      if (client.role === "control" && !client.approved) return;
      relayBus(client, m.msg);
    } else if (m.kind === "admin") {
      if (!client.admin) return;
      const id = String(m.id || "");
      const live = [...clients].find((c) => c.id === id);
      if (m.action === "approve" || m.action === "revoke") {
        const ok = m.action === "approve";
        if (live) live.approved = ok;
        if (registry[id]) registry[id].approved = ok;
      } else if (m.action === "rename") {
        const name = String(m.name || "").slice(0, 40) || "Device";
        if (live) live.name = name;
        if (registry[id]) registry[id].name = name;
      } else if (m.action === "remove") {
        delete registry[id];
        if (live) {
          live.approved = false;
          send(live.ws, stateFor(live));
          try {
            live.ws.close();
          } catch {
            /* ignore */
          }
        }
      }
      saveRegistry();
      broadcastState();
    }
  });

  ws.on("close", () => {
    clients.delete(client);
    broadcastState();
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  const urls = lanUrls();
  console.log(`\n  Wedding dashboard server → http://localhost:${PORT}`);
  if (fs.existsSync(DIST_DIR)) {
    console.log(`  TV display (this laptop):  http://localhost:${PORT}/`);
    console.log(`  Control (this laptop):     http://localhost:${PORT}/control`);
  } else {
    console.log(`  (dev) TV display: http://localhost:5173/`);
    console.log(`  (dev) Control:    http://localhost:5173/control`);
  }
  if (urls.length) {
    console.log(`\n  Control from your phone (same Wi-Fi / hotspot):`);
    for (const u of urls) console.log(`    ${u}`);
    console.log(`  (approve the phone in the control panel's Devices panel)`);
  }
  console.log("");
});
