// Auto-installs Piper (offline TTS) + the EN/FA voices if they're not already
// set up. Cross-platform: Windows uses the prebuilt binary; macOS/Linux use the
// pip package in a local virtualenv. Idempotent — safe to run on every start.
// Runs automatically before `npm run dev` / `npm start` (see package.json).
// Skip with SKIP_TTS_SETUP=1.

import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "tts.config.json");
const VOICES = path.join(ROOT, "voices");
const VENV = path.join(ROOT, ".venv-piper");
const PIPER_DIR = path.join(ROOT, "piper");

const VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const VOICE_FILES = [
  { key: "en", id: "en_US-amy-medium", rel: "en/en_US/amy/medium" },
  { key: "fa", id: "fa_IR-amir-medium", rel: "fa/fa_IR/amir/medium" },
];

const log = (m) => console.log(`  [tts-setup] ${m}`);

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return { piperPath: "piper", voices: {} };
  }
}

function piperBinaryPath() {
  if (process.platform === "win32") {
    // venv (pip) or downloaded binary
    const venvExe = path.join(VENV, "Scripts", "piper.exe");
    if (fs.existsSync(venvExe)) return venvExe;
    return path.join(PIPER_DIR, "piper.exe");
  }
  const venvBin = path.join(VENV, "bin", "piper");
  if (fs.existsSync(venvBin)) return venvBin;
  return path.join(PIPER_DIR, "piper");
}

function voicesPresent() {
  return VOICE_FILES.every((v) =>
    fs.existsSync(path.join(VOICES, `${v.id}.onnx`)),
  );
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function ensureVoices() {
  fs.mkdirSync(VOICES, { recursive: true });
  for (const v of VOICE_FILES) {
    const onnx = path.join(VOICES, `${v.id}.onnx`);
    const json = path.join(VOICES, `${v.id}.onnx.json`);
    if (fs.existsSync(onnx) && fs.existsSync(json)) continue;
    log(`downloading voice ${v.id} …`);
    await download(`${VOICE_BASE}/${v.rel}/${v.id}.onnx`, onnx);
    await download(`${VOICE_BASE}/${v.rel}/${v.id}.onnx.json`, json);
  }
}

function findPython() {
  const candidates = [
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10",
    process.platform === "win32" ? "python" : "python3",
  ];
  for (const c of candidates) {
    try {
      const v = execFileSync(c, ["--version"], { encoding: "utf8" }).trim();
      const m = v.match(/(\d+)\.(\d+)/);
      if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10))) {
        return c;
      }
    } catch {
      /* not found, keep looking */
    }
  }
  return null;
}

function installViaPip() {
  const py = findPython();
  if (!py) {
    throw new Error(
      "Python 3.10+ not found. Install Python (python.org or `brew install python`) and re-run.",
    );
  }
  log(`creating virtualenv with ${py} …`);
  execFileSync(py, ["-m", "venv", VENV], { stdio: "inherit" });
  const pip = path.join(VENV, "bin", "pip");
  execFileSync(pip, ["install", "--quiet", "--upgrade", "pip"], { stdio: "inherit" });
  log("installing piper-tts (this can take a minute) …");
  execFileSync(pip, ["install", "--quiet", "piper-tts"], { stdio: "inherit" });
  return path.join(VENV, "bin", "piper");
}

async function installBinary() {
  // Windows / Linux prebuilt binary (self-contained, no Python needed).
  const rel = "2023.11.14-2";
  const asset =
    process.platform === "win32"
      ? "piper_windows_amd64.zip"
      : process.arch === "arm64"
        ? "piper_linux_aarch64.tar.gz"
        : "piper_linux_x86_64.tar.gz";
  const url = `https://github.com/rhasspy/piper/releases/download/${rel}/${asset}`;
  const tmp = path.join(ROOT, asset);
  log(`downloading Piper (${asset}) …`);
  await download(url, tmp);
  log("extracting …");
  // bsdtar (`tar`) handles both .zip and .tar.gz on Windows 10+/macOS/Linux.
  execFileSync("tar", ["-xf", tmp, "-C", ROOT], { stdio: "inherit" });
  fs.rmSync(tmp, { force: true });
  const bin = piperBinaryPath();
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(bin, 0o755);
    } catch {
      /* ignore */
    }
  }
  return bin;
}

async function main() {
  if (process.env.SKIP_TTS_SETUP) return;

  const cfg = readConfig();
  // Already configured to a working binary + voices? Then we're done.
  const configured =
    cfg.piperPath &&
    (cfg.piperPath === "piper" ||
      fs.existsSync(
        path.isAbsolute(cfg.piperPath)
          ? cfg.piperPath
          : path.join(ROOT, cfg.piperPath),
      ));
  if (configured && voicesPresent()) {
    return; // ready, stay quiet
  }

  log("offline voice (Piper) not set up — installing…");
  let piperBin;
  try {
    if (process.platform === "darwin") {
      piperBin = installViaPip(); // mac prebuilt binary is broken; use pip
    } else if (process.platform === "win32") {
      piperBin = await installBinary();
    } else {
      // linux: try binary first, fall back to pip
      try {
        piperBin = await installBinary();
      } catch {
        piperBin = installViaPip();
      }
    }
    await ensureVoices();

    const relBin = path.relative(ROOT, piperBin).split(path.sep).join("/");
    cfg.piperPath = relBin;
    cfg.voices = {
      en: "voices/en_US-amy-medium.onnx",
      fa: "voices/fa_IR-amir-medium.onnx",
    };
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n");
    log(`done. Piper at ${relBin}, voices: en, fa.`);
  } catch (e) {
    log(`could not auto-install offline voice: ${e.message}`);
    log("The app will still run; on-demand TTS just won't be available.");
    // Don't fail the start.
  }
}

main();
