# OC-Mill — Orange Cat Story Agent

Automated TikTok content pipeline for vertical video stories about a chubby orange cat. Story → per-scene keyframes → per-scene video clips → TTS narration → ffmpeg composition → TikTok upload.

## Pipeline

```
Story (LLM, structured outputs)
  └─► Character reference image                  (cached per archetype)
  └─► For each scene (parallel, p-limited):
        1. Keyframe image                        (text + character ref)
        2. VLM eval gate                         (1 retry on fail)
        3. Video clip                            (image-to-video)
        4. TTS narration                         (mood-mapped voice)
  └─► ffmpeg compositor                          (concat + audio mix + ASS subs)
  └─► Validate composed output
  └─► TikTok Content Posting API
  └─► Statistics
```

All generation goes through **OpenRouter** (LLM, image, video, VLM). TTS is **ElevenLabs**. Publishing is the **TikTok Content Posting API**.

## Stack

| Layer | Default | Configurable via |
|---|---|---|
| LLM (story + eval) | `openai/gpt-5` | `OPENROUTER_LLM_MODEL`, `OPENROUTER_VLM_MODEL` |
| Image (character ref + keyframes) | `openai/gpt-5.4-image-2` | `OPENROUTER_IMAGE_MODEL` |
| Video (image-to-video) | `bytedance/seedance-2.0` | `OPENROUTER_VIDEO_MODEL` |
| TTS | ElevenLabs `eleven_multilingual_v2`, per-mood voice IDs | `ELEVENLABS_VOICE_*` |
| Compositor | ffmpeg (system binary) via `fluent-ffmpeg` | — |

## Requirements

- Node.js 20+
- ffmpeg on `PATH`
- API keys: OpenRouter, ElevenLabs, TikTok (OAuth 2.0 access token with `video.upload` scope)

## Setup

```bash
npm install
cp .env.example .env
# Fill in OPENROUTER_API_KEY, ELEVENLABS_API_KEY, TIKTOK_API_KEY
npm run build
```

## Usage

```bash
npm start                                                # full pipeline, single video
npm start -- --dry                                       # LLM-only, no media generation
npm start -- --count 3                                   # 3 sequential runs
npm start -- --loop                                      # repeat every RUN_INTERVAL_HOURS
npm start -- --stats                                     # show run history + success rate

# Dev loop: regenerate one scene from a saved story without re-running everything
npm start -- --scene 4 --story-file /tmp/oc-mill-videos/run-2026-05-09T.../story.json
```

## Configuration

All config lives in environment variables. See `.env.example` for the full list. Notable knobs:

| Variable | Default | Purpose |
|---|---|---|
| `VIDEO_DURATION_SECONDS` | `55` | Total target duration |
| `CLIP_DURATION_SECONDS` | `7` | Per-scene clip length |
| `SCENE_CONCURRENCY` | `2` | Parallel scenes per stage |
| `EVAL_RETRIES_PER_SCENE` | `1` | VLM eval gate retries (0 = off) |
| `MAX_POLL_ATTEMPTS` | `120` | Async video job poll cap |
| `POLL_INTERVAL_MS` | `10000` | Initial poll interval (exponential backoff) |
| `CHARACTER_REF_DIR` | `/tmp/oc-mill-character-refs` | Where character ref images are cached |
| `VIDEO_DOWNLOAD_PATH` | `/tmp/oc-mill-videos` | Run output root |
| `TIKTOK_VISIBILITY` | `public` | `public` / `friends` / `private` |

## Layout

```
src/
├── agent/OrangeCatAgent.ts       Orchestrator
├── pipeline/concurrency.ts       Bounded-concurrency runner
├── llm/
│   ├── StoryService.ts           OpenRouter chat + structured outputs
│   ├── EvalService.ts            VLM scene QA
│   └── schemas.ts                Zod + JSON Schema for structured outputs
├── media/
│   ├── ImageService.ts           Per-scene keyframes (with optional eval gate)
│   ├── VideoClipService.ts       Image-to-video, parallel
│   ├── NarrationService.ts       ElevenLabs TTS, per-mood voices
│   └── Compositor.ts             ffmpeg compose + ASS subtitle burn-in
├── clients/
│   ├── OpenRouterImageClient.ts
│   ├── OpenRouterVideoClient.ts
│   ├── ElevenLabsClient.ts
│   └── TikTokClient.ts
├── services/
│   ├── CharacterReferenceCache.ts
│   ├── VideoValidator.ts
│   └── StatisticsTracker.ts
├── caption/CaptionGenerator.ts
├── story/types.ts                Story / Scene / Mood / ArchetypeName
├── utils/{config,logger,RateLimiter}.ts
└── index.ts
```

## Cost estimate

For 8 scenes × 7s on Seedance 2.0 (~$0.03/sec):

| Stage | Approx cost |
|---|---|
| Story (LLM, cached) | ~$0.005 |
| Character reference (amortized over many runs) | ~$0.00 |
| 8 keyframes | ~$0.08 |
| 8 video clips × 7s × $0.03 | ~$1.80 |
| 8 VLM eval calls | ~$0.05 |
| TTS narration | ~$0.10 |
| TikTok upload | free |
| **Total per video** | **~$2.05** |

Add ~30–50% if many scenes hit the eval-retry budget. Swap `OPENROUTER_VIDEO_MODEL` to `google/veo-3.1-fast` (~$0.09/sec, native audio) if you want premium quality and to drop the TTS step.

## Troubleshooting

- **`ffmpeg not found on PATH`** — install ffmpeg (`apt install ffmpeg` / `brew install ffmpeg`). Logged as a warning at startup; required for the compositor.
- **Cat looks different scene to scene** — delete `${CHARACTER_REF_DIR}/<archetype>.png` to force a fresh canonical reference, then re-run.
- **TikTok upload fails** — verify the OAuth token has `video.upload` scope and is not expired.
- **VLM keeps failing keyframes** — check `logs/combined.log` for the reviewer feedback. Bump `EVAL_RETRIES_PER_SCENE=2` or set to `0` to bypass.

## License

MIT
