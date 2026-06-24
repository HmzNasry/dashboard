# media/

Pre-generated announcement audio goes **here**. Files are served at `/audio/<name>`.

Example: `announcements.json` referencing `"/audio/welcome-en.mp3"` means a file
`media/welcome-en.mp3` must exist here.

- `media/*.mp3|wav` — your reviewed, pre-generated clips (recommended: high-quality
  cloud TTS, see the main README).
- `media/generated/` — auto-created; holds on-demand offline clips made during the
  event. Safe to delete.
