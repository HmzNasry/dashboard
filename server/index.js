import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const MEDIA_DIR = path.join(ROOT, "media");
const GEN_DIR = path.join(MEDIA_DIR, "generated");
const DIST_DIR = path.join(ROOT, "dist");
const PORT = process.env.PORT || 3001;

fs.mkdirSync(GEN_DIR, { recursive: true });

// ---- TTS config ----------------------------------------------------------
// Edit tts.config.json to point at your Piper binary + voice models.
function loadTtsConfig() {
  const f = path.join(ROOT, "tts.config.json");
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return { piperPath: "piper", voices: {} };
  }
}

function voicePath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---- Content (read fresh each request so JSON edits show up live) ---------
function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
}

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

  // Cache by content hash so repeats are instant and idempotent.
  const hash = createHash("sha1").update(`${lang}:${text}`).digest("hex").slice(0, 16);
  const fileName = `${lang}-${hash}.wav`;
  const outPath = path.join(GEN_DIR, fileName);
  const url = `/audio/generated/${fileName}`;
  if (fs.existsSync(outPath)) return res.json({ ok: true, url });

  try {
    await runPiper(cfg.piperPath || "piper", model, text, outPath);
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

// ---- Static: pre-generated audio + (in prod) the built app ---------------
app.use("/audio", express.static(MEDIA_DIR));

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA fallback for /control etc.
  app.get(/^(?!\/(api|audio)).*/, (_req, res) =>
    res.sendFile(path.join(DIST_DIR, "index.html")),
  );
}

app.listen(PORT, () => {
  console.log(`\n  Wedding dashboard server → http://localhost:${PORT}`);
  if (fs.existsSync(DIST_DIR)) {
    console.log(`  Display:  http://localhost:${PORT}/`);
    console.log(`  Control:  http://localhost:${PORT}/control\n`);
  } else {
    console.log(`  (dev) Display: http://localhost:5173/`);
    console.log(`  (dev) Control: http://localhost:5173/control\n`);
  }
});
