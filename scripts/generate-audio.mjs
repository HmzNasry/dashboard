// Batch-generate announcement audio with Piper (fully offline alternative to
// cloud TTS). Reads data/announcements.json and produces a WAV for every
// language referenced in each announcement's `audio` map, into media/.
//
// Usage:  node scripts/generate-audio.mjs            (skip existing)
//         node scripts/generate-audio.mjs --force     (regenerate all)
//
// For the real wedding clips, cloud TTS (Azure/Google/ElevenLabs) sounds
// better — especially Persian. This is the no-account, no-internet option.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "tts.config.json"), "utf8"));
const { announcements } = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "announcements.json"), "utf8"),
);

const voice = (l) => {
  const p = cfg.voices?.[l];
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
};

function piper(model, text, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cfg.piperPath || "piper", [
      "--model",
      model,
      "--output_file",
      outPath,
    ]);
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(err))));
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

let made = 0,
  skipped = 0;
for (const a of announcements) {
  for (const lang of Object.keys(a.audio || {})) {
    const rel = a.audio[lang]; // e.g. /audio/welcome-en.mp3
    const out = path.join(ROOT, "media", rel.replace(/^\/audio\//, ""));
    // Piper emits WAV; write alongside with .wav so playback still works.
    const outWav = out.replace(/\.(mp3|wav)$/i, ".wav");
    if (!force && fs.existsSync(outWav)) {
      skipped++;
      continue;
    }
    const model = voice(lang);
    if (!model || !fs.existsSync(model)) {
      console.warn(`! no voice for "${lang}" — skipping ${a.id}`);
      continue;
    }
    fs.mkdirSync(path.dirname(outWav), { recursive: true });
    process.stdout.write(`→ ${a.id} [${lang}] … `);
    await piper(model, a.text[lang], outWav);
    console.log("ok");
    made++;
  }
}
console.log(`\nDone. generated ${made}, skipped ${skipped}.`);
console.log(
  "Note: files are .wav. Update announcements.json audio paths to .wav, or convert to .mp3 with ffmpeg.",
);
