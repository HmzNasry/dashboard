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

const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const VOICE = process.env.GEMINI_VOICE || "Kore"; // multilingual; handles EN + FA
const FORCE = process.argv.includes("--force");
const RATE_MS = 4500; // ~13 req/min, under the 15 RPM free-tier limit

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    return fs.readFileSync(path.join(ROOT, ".gemini.key"), "utf8").trim();
  } catch {
    return null;
  }
}

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

async function tts(key, text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
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

async function main() {
  const key = apiKey();
  if (!key) {
    console.error("No API key. Run: echo 'YOUR_KEY' > .gemini.key");
    process.exit(1);
  }
  fs.mkdirSync(MEDIA, { recursive: true });
  const data = JSON.parse(fs.readFileSync(ANN, "utf8"));
  let made = 0;

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
      const wav = await tts(key, text);
      fs.writeFileSync(dest, wav);
      console.log(`ok (${Math.round(wav.length / 1024)} KB)`);
      made++;
      await sleep(RATE_MS);
    }
  }

  fs.writeFileSync(ANN, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nDone. Generated ${made} clip(s); announcements.json updated.`);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
