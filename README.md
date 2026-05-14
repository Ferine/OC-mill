# OC-Mill — Brainrot Studio

Automated short-form video pipeline for recurring TikTok characters. Each "brand" is a JSON character sheet (orange cat, Ballerina Cappuccina, Tung Tung Tung Sahur, …). The pipeline turns a brand into: a story → per-scene keyframes → per-scene video clips → TTS narration → optional Lyria music bed → ffmpeg composition with burned-in captions → TikTok upload.

Originally a single-character agent ("OC" = Orange Cat); now a multi-brand mill with a web UI on top.

## Pipeline

```
Brand JSON  ──►  Story (LLM, structured outputs)
                  └─► Character reference image            (cached per brand+archetype)
                  └─► For each scene (parallel, p-limited):
                        1. Keyframe image                   (text + character ref)
                        2. VLM eval gate                    (1 retry on fail)
                        3. Video clip                       (image-to-video)
                        4. TTS narration                    (mood-mapped voice)
                  └─► Optional Lyria music bed              (mood-aware prompt)
                  └─► ffmpeg compositor                     (concat + audio mix + ASS subs)
                  └─► Validate composed output
                  └─► TikTok Content Posting API
                  └─► Statistics
```

All generation — LLM, image, video, VLM, TTS, music — routes through **OpenRouter**. Publishing is the **TikTok Content Posting API**. There is no ElevenLabs dependency.

## Stack

| Layer | Default | Configurable via |
|---|---|---|
| LLM (story + eval) | `openai/gpt-5` | `OPENROUTER_LLM_MODEL`, `OPENROUTER_VLM_MODEL` |
| Image (character ref + keyframes) | `openai/gpt-5.4-image-2` | `OPENROUTER_IMAGE_MODEL` |
| Video (image-to-video) | `bytedance/seedance-2.0` | `OPENROUTER_VIDEO_MODEL` |
| TTS | `google/gemini-3.1-flash-tts-preview`, per-mood prebuilt voices | `OPENROUTER_TTS_MODEL`, `TTS_VOICE_*` |
| Music (optional) | `google/lyria-3-pro-preview` | `OPENROUTER_MUSIC_MODEL`, `MUSIC_ENABLED` |
| Compositor | ffmpeg (system binary) via `fluent-ffmpeg` | — |
| HTTP / Web UI | Fastify + Vite/React (`web/`) | `pnpm serve` |

## Requirements

- Node.js 20+
- pnpm 10+
- ffmpeg on `PATH`
- API keys: OpenRouter, TikTok (OAuth 2.0 access token with `video.upload` scope)

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in OPENROUTER_API_KEY and TIKTOK_API_KEY
pnpm build
```

`pnpm build` builds both the server (`tsc`) and the web UI (`pnpm --filter oc-mill-web build`). The compiled UI is served by Fastify in server mode.

## Usage

```bash
pnpm start                                                # full pipeline, single video, default brand
pnpm start --dry                                          # LLM-only, no media generation
pnpm start --count 3                                      # 3 sequential runs
pnpm start --loop                                         # repeat every RUN_INTERVAL_HOURS
pnpm start --stats                                        # show run history + success rate
pnpm start --resume latest                                # resume the most recent partial run
pnpm start --resume /tmp/oc-mill-videos/run-2026-...      # resume a specific run dir

# Web UI + REST API (Fastify on :5173 by default)
pnpm serve
pnpm serve --server 8080                                  # custom port

# Dev loop: regenerate one scene from a saved story without re-running everything
pnpm start --scene 4 --story-file /tmp/oc-mill-videos/run-.../story.json

# Frontend dev (Vite HMR against a running server)
pnpm dev:web
```

The brand used for a run is selected by the request (web UI / `POST /api/runs`) or falls back to `DEFAULT_BRAND_ID`. Brands live in `brands/*.json` and can be created, edited, or seeded via the UI / API.

## HTTP API (server mode)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/runs` | List tracked runs |
| `POST` | `/api/runs` | Start a new run (body picks brand, archetype, etc.) |
| `GET` | `/api/runs/:id` | Run status + metadata |
| `POST` | `/api/runs/:id/resume` | Resume a failed/partial run |
| `GET` | `/api/runs/:id/events` | SSE stream of pipeline events |
| `GET` | `/api/runs/:id/files/*` | Serve artifacts from the run dir |
| `GET` | `/api/brands` | List installed brands |
| `GET` `POST` `PUT` `DELETE` | `/api/brands[/:id]` | CRUD a brand |
| `POST` | `/api/brands/:id/suggest-seed` | LLM-generated seed for a new archetype |

## Configuration

All config lives in environment variables. See `.env.example` for the full list. Notable knobs:

| Variable | Default | Purpose |
|---|---|---|
| `BRANDS_DIR` | `./brands` | Where brand JSON files live |
| `DEFAULT_BRAND_ID` | `orange-cat` | Brand used when none is specified |
| `VIDEO_DURATION_SECONDS` | `55` | Total target duration |
| `CLIP_DURATION_SECONDS` | `7` | Per-scene clip length |
| `SCENE_CONCURRENCY` | `2` | Parallel scenes per stage |
| `EVAL_RETRIES_PER_SCENE` | `1` | VLM eval gate retries (0 = off) |
| `MAX_POLL_ATTEMPTS` | `120` | Async video job poll cap |
| `POLL_INTERVAL_MS` | `10000` | Initial poll interval (exponential backoff) |
| `MUSIC_ENABLED` | `false` | Generate a Lyria music bed (~$0.08/run) |
| `MUSIC_VOLUME_DB` | `-18` | Music level relative to narration |
| `CHARACTER_REF_DIR` | `/tmp/oc-mill-character-refs` | Where character refs are cached (per brand) |
| `VIDEO_DOWNLOAD_PATH` | `/tmp/oc-mill-videos` | Run output root |
| `TIKTOK_VISIBILITY` | `public` | `public` / `friends` / `private` |
| `SUBTITLE_FONT_PATH` | auto-probed | Override the burned-in caption font |

## Brands

Each brand is a single JSON file describing the character and its archetypes. Shipped brands:

```
brands/
├── ballerina-cappuccina.json
├── brazilian-terrier.json
├── goblin-frog-mall.json
├── gop-debate-frog.json
├── orange-cat.json
├── tralalero-tralala.json
└── tung-tung-tung-sahur.json
```

A brand declares its character, reference-sheet prompt, scene-continuity rules, VLM pass/fail criteria, and a list of archetypes (story templates). The schema is enforced in `src/brand/schemas.ts`.

## Layout

```
src/
├── agent/StoryAgent.ts                  Orchestrator (multi-brand)
├── brand/
│   ├── BrandRegistry.ts                 Filesystem-backed brand CRUD
│   ├── defaultBrand.ts                  Bundled fallback brand
│   ├── schemas.ts                       Zod schema for brand JSON
│   └── types.ts
├── pipeline/
│   ├── concurrency.ts                   Bounded-concurrency runner
│   └── events.ts                        SSE pipeline events
├── llm/
│   ├── StoryService.ts                  OpenRouter chat + structured outputs
│   ├── EvalService.ts                   VLM scene QA
│   └── schemas.ts                       Zod + JSON Schema for structured outputs
├── media/
│   ├── ImageService.ts                  Per-scene keyframes (with optional eval gate)
│   ├── VideoClipService.ts              Image-to-video, parallel
│   ├── NarrationService.ts              OpenRouter TTS, per-mood voices
│   ├── MusicService.ts                  Lyria music bed (optional)
│   └── Compositor.ts                    ffmpeg compose + ASS subtitle burn-in
├── clients/
│   ├── OpenRouterImageClient.ts
│   ├── OpenRouterVideoClient.ts
│   ├── OpenRouterTTSClient.ts
│   ├── OpenRouterMusicClient.ts
│   └── TikTokClient.ts
├── server/
│   ├── HttpServer.ts                    Fastify routes + SSE + static UI
│   └── runRegistry.ts                   In-memory run tracker
├── services/
│   ├── CharacterReferenceCache.ts
│   ├── VideoValidator.ts
│   └── StatisticsTracker.ts
├── caption/CaptionGenerator.ts
├── story/types.ts                       Story / Scene / Mood
├── utils/{config,logger,io,RateLimiter}.ts
└── index.ts

web/                                     Vite + React frontend (pnpm workspace)
brands/                                  Brand JSON library
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
| TTS narration (Gemini Flash) | ~$0.02 |
| Music bed (Lyria 3 Pro, optional) | ~$0.08 |
| TikTok upload | free |
| **Total per video** | **~$1.95** (no music) / **~$2.05** (with music) |

Add ~30–50% if many scenes hit the eval-retry budget. Swap `OPENROUTER_VIDEO_MODEL` to `google/veo-3.1-fast` (~$0.09/sec, native audio) if you want premium quality and can drop the TTS step.

## Troubleshooting

- **`ffmpeg not found on PATH`** — install ffmpeg (`apt install ffmpeg` / `brew install ffmpeg`). Logged as a warning at startup; required for the compositor.
- **Character looks different scene to scene** — delete the cached reference under `${CHARACTER_REF_DIR}/<brand>/<archetype>.png` to force a fresh canonical reference, then re-run.
- **TikTok upload fails** — verify the OAuth token has `video.upload` scope and is not expired.
- **VLM keeps failing keyframes** — check `logs/combined.log` for the reviewer feedback. Bump `EVAL_RETRIES_PER_SCENE=2` or set to `0` to bypass.
- **Run died mid-pipeline** — `pnpm start --resume latest` picks up from the last persisted artifact in the run directory.

## License

MIT
