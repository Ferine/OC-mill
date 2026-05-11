# Background music

Drop royalty-free `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, or `.aac` files into the per-mood subdirectories below. At compose time the pipeline picks one track at random for the story's `overallMood`, loops it to match the video length, ducks it to ~−14 dB under the narration, and fades it in/out at start and end.

```
assets/music/
├── heartwarming/        # warm strings, soft pianos, gentle ukulele
├── funny/               # bouncy, comedic, plucky strings, kazoo, tubas
├── dramatic/            # cinematic builds, big drums, suspense
├── sad/                 # slow piano, melancholy strings, lonely ambient
├── hopeful/             # rising chords, optimistic acoustic, soft synth
├── epic/                # heroic orchestral, taiko, trailer hits
└── default/             # fallback when the mood folder is empty
```

The picked track is persisted to `runDir/music.json` so a resumed run reuses the same song. Delete `music.json` to force a fresh roll.

## Where to find royalty-free music

All of these are safe to use in TikTok content. Always double-check the license on each individual track.

- **[Pixabay Music](https://pixabay.com/music/)** — CC0 / Pixabay Content License, no attribution required. Largest free library.
- **[YouTube Audio Library](https://www.youtube.com/audiolibrary)** — Google-curated, attribution-free for most tracks.
- **[Free Music Archive](https://freemusicarchive.org/)** — wide range of Creative Commons licenses. Check each track.
- **[Mixkit Music](https://mixkit.co/free-stock-music/)** — Mixkit License (free for commercial use).
- **[Bensound](https://www.bensound.com/)** — free tier with attribution; paid tier removes attribution.
- **[Incompetech](https://incompetech.com/music/royalty-free/)** — Kevin MacLeod, CC-BY 4.0. Iconic library, includes plenty of cheese.
- **[ccMixter](http://dig.ccmixter.org/)** — Creative Commons remixes and originals.

## Cheesy / TikTok-friendly picks to start with

These are good archetype-matching jumping-off points. Search the libraries above for the title, or use as inspiration for similar vibes:

| Mood | Try searching for… |
|---|---|
| heartwarming | "ukulele happy", "soft piano cute", "marshmallow", "wholesome acoustic" |
| funny | "comedy tuba", "boopy", "silly walk", "kazoo cartoon", "pizzicato funny" |
| dramatic | "epic build", "tension orchestral", "cinematic drums" |
| sad | "lonely piano", "melancholy strings", "rainy day", "alone" |
| hopeful | "sunrise", "indie acoustic optimistic", "uplifting piano" |
| epic | "trailer hit", "taiko hero", "victory orchestral", "boss battle" |

## Tuning

- `MUSIC_VOLUME` (default `0.2`) — overall music gain. `0.1` is barely there; `0.3` competes with narration.
- `MUSIC_FADE_SECONDS` (default `2`) — fade in/out duration.
- `MUSIC_DIR` (default `./assets/music`) — point at a different library if you keep music elsewhere.

If a mood folder is empty, the library falls back to `default/`. If that's also empty, the pipeline skips music entirely and the video uses only narration audio.
