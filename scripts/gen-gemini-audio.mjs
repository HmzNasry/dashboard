// Pre-generate broadcast audio with the Gemini TTS API (high quality, esp. for
// Persian). Run ONCE while online; the resulting files play offline at the venue.
//
//   echo 'YOUR_KEY' > .gemini.key      # or set GEMINI_API_KEY
//   node scripts/gen-gemini-audio.mjs  # add --force to overwrite existing
//
// Writes media/<id>-<lang>.wav and points announcements.json at them. Events
// aren't spoken, so only the broadcasts are generated.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA = path.join(ROOT, "media");
const ANN = path.join(ROOT, "data", "announcements.json");

// Latest first, then fall back automatically when a model's daily quota is hit.
const MODELS = [
  process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
].filter((m, i, a) => a.indexOf(m) === i);
const VOICE = process.env.GEMINI_VOICE || "Achernar"; // soft female; multilingual
const FORCE = process.argv.includes("--force");
const RATE_MS = 4500; // ~13 req/min, under the 15 RPM free-tier limit

// One or more API keys (env GEMINI_API_KEY comma-separated, or .gemini.key one
// per line). The script rotates to the next key when a key's quota runs out.
function keys() {
  let raw = process.env.GEMINI_API_KEY || "";
  if (!raw) {
    try {
      raw = fs.readFileSync(path.join(ROOT, ".gemini.key"), "utf8");
    } catch {
      raw = "";
    }
  }
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const KEYS = keys();

// Wrap raw PCM (signed 16-bit LE, mono) in a minimal WAV container.
function pcmToWav(pcm, sampleRate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits/sample
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function tts(key, text, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("no audio in response");
  const mime = part.inlineData.mimeType || "";
  const rate = Number(mime.match(/rate=(\d+)/)?.[1] || 24000);
  return pcmToWav(Buffer.from(part.inlineData.data, "base64"), rate);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// On a 429 (quota) advance to the next model; when a key's models are all
// exhausted, switch to the next key (and start again at the newest model).
let keyIdx = 0;
let modelIdx = 0;
async function ttsAny(text) {
  while (keyIdx < KEYS.length) {
    while (modelIdx < MODELS.length) {
      try {
        return await tts(KEYS[keyIdx], text, MODELS[modelIdx]);
      } catch (e) {
        if (/HTTP 429/.test(e.message)) {
          console.log(`(quota: key #${keyIdx + 1} / ${MODELS[modelIdx]} → next)`);
          modelIdx++;
          continue;
        }
        throw e;
      }
    }
    keyIdx++;
    modelIdx = 0;
    if (keyIdx < KEYS.length) console.log(`→ switching to key #${keyIdx + 1}`);
  }
  throw new Error("all keys/models exhausted — try again after reset");
}

async function main() {
  if (!KEYS.length) {
    console.error("No API key. Run: echo 'YOUR_KEY' > .gemini.key");
    process.exit(1);
  }
  console.log(`${KEYS.length} key(s), models: ${MODELS.join(", ")}`);
  fs.mkdirSync(MEDIA, { recursive: true });
  const data = JSON.parse(fs.readFileSync(ANN, "utf8"));
  let made = 0;

  // Persist announcements.json even on partial failure (e.g. daily quota), so a
  // later re-run just fills in what's missing.
  const save = () => fs.writeFileSync(ANN, JSON.stringify(data, null, 2) + "\n");
  try {
    for (const a of data.announcements) {
      a.audio = a.audio || {};
      for (const lang of ["en", "fa"]) {
        const text = a.text?.[lang];
        if (!text || !text.trim()) continue;
        const file = `${a.id}-${lang}.wav`;
        const dest = path.join(MEDIA, file);
        a.audio[lang] = `/audio/${file}`; // point the app at the generated clip
        if (!FORCE && fs.existsSync(dest)) {
          process.stdout.write(`· skip ${file}\n`);
          continue;
        }
        process.stdout.write(`→ ${file} … `);
        const wav = await ttsAny(text);
        fs.writeFileSync(dest, wav);
        console.log(`ok via ${MODELS[modelIdx]} (${Math.round(wav.length / 1024)} KB)`);
        made++;
        save();
        await sleep(RATE_MS);
      }
    }
  } finally {
    save();
  }
  console.log(`\nDone. Generated ${made} clip(s); announcements.json updated.`);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
