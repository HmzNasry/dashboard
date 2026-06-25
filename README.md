# 💍 Wedding Venue Dashboard

A live schedule + announcements dashboard for venue TVs, with bilingual
(English / Persian) text-to-speech. Built to run **fully offline** on one laptop.

- **Display view** (`/`) → fullscreen on the TVs. Couple header, live clock,
  "Happening now", "Up next", full timeline, and full-screen announcements with
  the airplane cabin **chime** before each one.
- **Control panel** (`/control`) → on the laptop screen. Pin the current segment,
  fire pre-written announcements, and generate on-the-spot announcements offline.

The two windows talk to each other instantly over a same-machine channel — **no
network needed**.

---

## Quick start

```bash
npm install
npm run dev
```

- Display: <http://localhost:5173/>
- Control: <http://localhost:5173/control>

For the real event, build once and run the single server:

```bash
npm run preview        # builds, then serves everything on http://localhost:3001
# Display → http://localhost:3001/   ·   Control → http://localhost:3001/control
```

---

## Adding events & announcements (no code)

Everything lives in two JSON files. Edit them and refresh — the dashboard
re-polls every 15s, so changes appear without a rebuild.

- **`data/schedule.json`** — the couple, date, and timeline. Each event has a
  24h `time` ("HH:MM"), an `icon` (emoji), and bilingual `title` / `subtitle`.
- **`data/announcements.json`** — the announcement library shown as buttons in
  the control panel. Each has a `label`, bilingual `text`, optional `audio`
  file paths, and `chime` (true/false).

Pre-generated audio files go in **`media/`** and are referenced as
`/audio/<file>` (so `media/welcome-en.mp3` → `"/audio/welcome-en.mp3"`).

---

## Text-to-speech

Two paths, by design:

### 1. Pre-generated clips (recommended — the main path)

Write every announcement, generate the audio **at home with internet**, listen,
regenerate until perfect, and drop the files in `media/`. At the venue these play
straight from disk — no internet, no latency, no surprises.

For best quality (especially Persian) use a cloud neural voice once:
- **ElevenLabs** multilingual — best prosody, supports Persian.
- **Azure** Speech — `fa-IR` neural voices (Dilara, Farid).
- **Google Cloud** TTS — `fa-IR` voices.

Save each as `media/<id>-en.mp3` / `media/<id>-fa.mp3` and point the
`audio` paths in `announcements.json` at them. Tip: also pre-generate the
*likely* impromptu lines ("Dinner is served", "Please take your seats") so you
rarely need live generation.

### 2. On-demand offline TTS (the safety net)

For genuinely unplanned announcements with no internet, the control panel can
generate speech locally via **Piper**. English is great; Persian is usable but a
bit robotic — which is fine for a fallback.

Setup:
1. Install Piper: <https://github.com/rhasspy/piper> (download the binary for
   your OS, or `pip install piper-tts`).
2. Download voice models (each is an `.onnx` + matching `.onnx.json`) into a
   `voices/` folder — see <https://github.com/rhasspy/piper/blob/master/VOICES.md>.
   Suggested: `en_US-amy-medium` and `fa_IR-amir-medium` (or `fa_IR-gyro-medium`).
3. Edit **`tts.config.json`** so `piperPath` and the `voices` paths are correct.
4. Restart the server. The control panel header shows **Offline TTS: ready**.

You can also batch-generate every library clip with Piper offline:

```bash
node scripts/generate-audio.mjs          # makes WAVs in media/ for each announcement
```

Even with no TTS configured at all, you can still "Show text only" — the
announcement appears full-screen on the TVs without audio.

> **Audio output:** announcement sound plays through the laptop's **default
> playback device**. Set that to whatever drives the room — the TV over HDMI, or
> the venue PA if your laptop is plugged into the sound system.

---

## Day-of setup (TVs & display)

1. **Connect the laptop to the TV(s) via HDMI.**
   - One TV: plug straight in.
   - Multiple TVs showing the same screen: use a **1-in/N-out powered HDMI
     splitter** (laptop → splitter → each TV). All TVs mirror the one feed.
   - Ask the venue first — if they have a built-in distribution system you may
     just hand them one HDMI cable.
2. **Windows → Display settings → Multiple displays → "Extend these displays"**
   (not Duplicate). The laptop screen stays private for the control panel; the
   external output is the dashboard.
3. Open a browser, go to the **Display** URL, drag that window onto the TV
   output, and press **F11** for fullscreen (or run Chrome with `--kiosk`).
4. **Click once anywhere on the TV window** — this enables sound (you'll hear a
   soft chime). Do this during setup, before guests arrive.
5. On the laptop screen, open the **Control** URL in another window. You're live.

### Control from your phone (optional)

The control panel can run on a phone as a wireless remote — the laptop still
drives the TV and plays the sound. No internet needed, just a shared local
network:

1. Put the phone and laptop on the **same network** — a phone hotspot the laptop
   joins, or the laptop's Mobile Hotspot the phone joins. (Local only; internet
   is not required.)
2. When the server starts it prints a **phone URL** like
   `http://192.168.x.x:3001/control`. Open it on the phone, or scan the **QR
   code** in the control panel's **Devices** section on the laptop.
3. The phone shows "Waiting for approval." On the **laptop** control panel, find
   it under **Devices** and tap **Approve** (rename/remove available too).
   Approved phones are remembered next time.

The laptop (localhost) is always the trusted admin; phones must be approved
before they can drive the screen.

### Reliability checklist
- Test the whole flow at home first, including the chime through the TV/PA.
- Disable Windows sleep, screen saver, and notifications.
- Pre-generate all announcements; treat offline TTS as a backup only.
- Keep the splitter + long (active, if >15m) HDMI cables in your kit regardless
  of what the venue promises.

---

## How it's built

- **Front end:** Vite + React + TypeScript + Tailwind v4, Framer Motion for the
  smooth animations. `src/views/Display.tsx` and `src/views/Control.tsx`.
- **Bus:** a WebSocket relay through the server (`src/lib/net.ts`) carries
  messages control → server → display, so the control panel can run on another
  device. The server tracks connected devices and gates remote phones behind an
  approval (admin = the laptop itself / loopback).
- **Chime:** synthesized with the Web Audio API (`src/lib/chime.ts`) — no
  copyrighted sound file shipped.
- **Server:** Express (`server/index.js`) serves content from `data/`, the
  Piper TTS endpoints, audio from `media/`, and the built app in production.
