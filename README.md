# 🐱 OC-Mill - Orange Cat Story Agent

**Automated AI-powered TikTok content generation for fat orange cat stories**

OC-Mill is a production-ready Node.js/TypeScript agent that automatically generates, produces, and publishes vertical video stories about a chubby orange cat to TikTok.

## 📑 Table of Contents

- [Features](#-features)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Architecture Overview](#-architecture-overview)
- [Project Structure](#-project-structure)
- [How It Works](#-how-it-works)
- [TikTok Video Format](#-tiktok-video-format)
- [Story Archetypes](#-story-archetypes)
- [API Integration](#-api-integration)
- [API Setup Guide](#-api-setup-guide)
- [Configuration](#-configuration)
- [Usage Examples](#-usage-examples)
- [Cost Estimation](#-cost-estimation)
- [Monitoring](#-monitoring)
- [Production Deployment](#-production-deployment)
- [Troubleshooting](#-troubleshooting)
- [FAQ](#-faq)
- [Contributing](#-contributing)

## 🎯 Features

- **AI Story Generation**: Dynamic story creation using OpenAI GPT-4, or use 6 pre-built story archetypes
- **AI Video Creation**: Integration with Kling AI text-to-video API
- **Automated Publishing**: Direct upload to TikTok with captions and hashtags
- **Scheduling**: Run once, multiple times, or on a schedule
- **Production Ready**: Comprehensive error handling, logging, and configuration
- **Flexible**: Toggle between OpenAI-generated stories and template-based stories
- **Video Validation**: Automatic validation of generated videos before upload (file size, format, readability)
- **Statistics Tracking**: Performance metrics and success tracking with detailed reports
- **Rate Limiting**: Token bucket rate limiting to protect against API rate limit violations

## 📋 Requirements

- Node.js 20+
- Kling AI API key
- TikTok API credentials (OAuth access token)
- OpenAI API key (optional, for dynamic story generation)
- TypeScript

## 🚀 Quick Start

### 1. Installation

```bash
# Clone the repository
git clone <repository-url>
cd OC-mill

# Install dependencies
npm install

# or use yarn
yarn install
```

### 2. Configuration

Copy the example environment file and fill in your API credentials:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# OpenAI Configuration (Optional - for dynamic story generation)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o
USE_OPENAI_STORIES=true  # Set to false to use template-based stories

# Kling AI Configuration
KLING_API_KEY=your_kling_api_key_here
KLING_BASE_URL=https://api.kling.ai

# TikTok Configuration
TIKTOK_API_KEY=your_tiktok_access_token_here
TIKTOK_BASE_URL=https://open.tiktokapis.com

# Video Settings
VIDEO_DURATION_SECONDS=55
VIDEO_ASPECT_RATIO=9:16

# Optional Settings
LOG_LEVEL=info
TIKTOK_VISIBILITY=public
```

### 3. Build

```bash
npm run build
```

### 4. Run

```bash
# Run once
npm start

# Dry run (no API calls, just generate story/prompt)
npm start -- --dry

# Run multiple times
npm start -- --count 3

# Run continuously on schedule
npm start -- --loop

# View statistics and performance metrics
npm start -- --stats
```

## 🏗️ Architecture Overview

OC-Mill follows a clean, modular architecture with separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                     OrangeCatAgent                          │
│                   (Main Orchestrator)                       │
└─────────────────────────────────────────────────────────────┘
                             │
      ┌──────────────────────┼──────────────────────┐
      │                      │                      │
      ▼                      ▼                      ▼
┌──────────┐          ┌──────────┐          ┌──────────┐
│  Story   │          │  Video   │          │ TikTok   │
│Generation│          │Generation│          │Publishing│
└──────────┘          └──────────┘          └──────────┘
      │                      │                      │
      ▼                      ▼                      ▼
┌──────────┐          ┌──────────┐          ┌──────────┐
│ OpenAI/  │          │  Kling   │          │ TikTok   │
│Templates │────────▶ │  Client  │────────▶ │  Client  │
└──────────┘          └──────────┘          └──────────┘
      │                      │                      │
      └──────────────────────┴──────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Cross-Cutting   │
                    │   Concerns      │
                    ├─────────────────┤
                    │ • Rate Limiting │
                    │ • Validation    │
                    │ • Statistics    │
                    │ • Logging       │
                    └─────────────────┘
```

### Key Design Patterns

- **Service Layer Pattern**: Business logic separated into focused services (`OpenAIStoryService`, `VideoValidator`, `StatisticsTracker`)
- **Client Pattern**: API interactions encapsulated in dedicated clients (`KlingClient`, `TikTokClient`)
- **Builder Pattern**: `KlingPromptBuilder` constructs complex prompts from story data
- **Strategy Pattern**: Toggle between OpenAI and template-based story generation
- **Token Bucket Algorithm**: Rate limiting implementation prevents API throttling

### Technology Stack

- **Runtime**: Node.js 20+ with TypeScript (strict mode)
- **APIs**: OpenAI GPT-4, Kling AI, TikTok Content Posting API
- **Logging**: Winston with file and console transports
- **Configuration**: dotenv for environment management
- **HTTP Client**: node-fetch for API requests
- **File Operations**: Native Node.js fs/promises

## 📁 Project Structure

```
OC-mill/
├── src/
│   ├── agent/
│   │   └── OrangeCatAgent.ts          # Main orchestrator
│   ├── story/
│   │   ├── types.ts                    # Type definitions
│   │   ├── archetypes.ts               # Story templates
│   │   └── StoryGenerator.ts          # Template-based story generation
│   ├── services/
│   │   ├── OpenAIStoryService.ts      # OpenAI story generation
│   │   ├── VideoValidator.ts          # Video validation service
│   │   └── StatisticsTracker.ts       # Performance metrics tracking
│   ├── prompt/
│   │   └── KlingPromptBuilder.ts      # Kling prompt builder
│   ├── clients/
│   │   ├── KlingClient.ts             # Kling API client
│   │   └── TikTokClient.ts            # TikTok API client
│   ├── caption/
│   │   └── CaptionGenerator.ts        # TikTok caption generator
│   ├── utils/
│   │   ├── logger.ts                  # Winston logger
│   │   ├── config.ts                  # Configuration management
│   │   └── RateLimiter.ts             # API rate limiting
│   └── index.ts                        # Entry point
├── logs/
│   ├── combined.log                    # All logs
│   ├── error.log                       # Error logs
│   └── statistics.json                 # Performance statistics
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## 🎬 How It Works

The agent follows an 8-step production workflow:

1. **Generate Story** (with rate limiting): Creates a unique story about a fat orange cat
   - **Option A (OpenAI)**: Uses GPT-4 to dynamically generate creative stories based on archetypes
   - **Option B (Templates)**: Randomly selects from 6 pre-built story archetypes:
     - RagsToRiches
     - FromShelterToHome
     - StreamerCatGlowUp
     - VillainArcButSoft
     - ChonkToBestFriend
     - OfficeHeroJourney

2. **Build Prompt**: Converts story into detailed Kling AI prompt optimized for TikTok vertical format

3. **Create Video** (with rate limiting): Calls Kling API to start video generation

4. **Poll Status**: Waits for video completion with exponential backoff

5. **Download Video**: Downloads finished video to local storage

6. **Validate Video**: Checks file integrity, size, format, and readability before upload

7. **Generate Caption**: Creates TikTok caption with hashtags based on story mood

8. **Upload to TikTok** (with rate limiting): Publishes video to TikTok

9. **Record Statistics**: Tracks performance metrics, success rate, and run details

### Example Run Output

```
[2026-02-18T10:30:00.000Z] INFO: Starting OC-Mill agent run #1
[2026-02-18T10:30:00.123Z] INFO: Generating story using OpenAI (archetype: StreamerCatGlowUp)
[2026-02-18T10:30:05.456Z] INFO: Story generated: "The Accidental Influencer" (8 scenes, 58s)
[2026-02-18T10:30:05.500Z] INFO: Building Kling prompt (compact format, 9:16 vertical)
[2026-02-18T10:30:05.678Z] INFO: Creating video with Kling AI
[2026-02-18T10:30:06.123Z] INFO: Video job created: kling-job-abc123
[2026-02-18T10:30:06.124Z] INFO: Polling for video completion...
[2026-02-18T10:35:30.456Z] INFO: Video ready! Downloading...
[2026-02-18T10:35:45.789Z] INFO: Video downloaded: /tmp/oc-mill-videos/video-abc123.mp4 (42.3 MB)
[2026-02-18T10:35:45.890Z] INFO: Validating video...
[2026-02-18T10:35:46.012Z] INFO: ✓ Video validation passed
[2026-02-18T10:35:46.100Z] INFO: Generating TikTok caption (mood: funny)
[2026-02-18T10:35:46.234Z] INFO: Uploading to TikTok...
[2026-02-18T10:36:15.678Z] INFO: ✓ Video published successfully!
[2026-02-18T10:36:15.700Z] INFO: TikTok Post ID: 7234567890123456
[2026-02-18T10:36:15.701Z] INFO: Run completed in 6m 15s
```

### Story Generation Modes

**OpenAI Mode** (`USE_OPENAI_STORIES=true`):
- Generates unique, creative stories for every run
- Uses GPT-4 to create custom scenes, dialogue, and narrative arcs
- Leverages archetypes as creative inspiration
- More variety and unpredictability
- Requires OpenAI API key

**Template Mode** (`USE_OPENAI_STORIES=false`):
- Uses pre-written story templates
- Fast and deterministic
- No additional API costs
- Predictable, high-quality stories

## 📱 TikTok Video Format

OC-Mill generates videos optimized for maximum TikTok engagement:

### Video Specifications
- **Aspect Ratio**: 9:16 (vertical, 1080x1920)
- **Duration**: 55-60 seconds (optimal for TikTok algorithm)
- **Format**: MP4, H.264 codec
- **Frame Rate**: 30 FPS
- **File Size**: Typically 20-80 MB

### Viral Story Structure (6-10 Scenes)

Stories follow a proven emotional arc for maximum retention:

1. **Hook (5-8s)**: Immediate attention grab
   - Example: *"POV: You're the shelter cat nobody wanted for 156 days"*
   - Visual: Close-up of orange cat with sad eyes

2. **Establish Problem (5-8s)**: Set up the conflict
   - Example: *"Every day, families walked past his cage"*
   - Visual: Families looking at other cats

3. **Escalation (5-8s)**: Deepen the tension
   - Example: *"His best friend got adopted. He was alone."*
   - Visual: Empty cage next to him

4. **Turning Point (8-10s)**: The breakthrough moment
   - Example: *"Then one rainy Tuesday, SHE walked in..."*
   - Visual: Woman entering shelter, slow motion

5. **Payoff (10-15s)**: Resolution and emotional release
   - Example: *"She said: 'This one. The chonky orange one.'"*
   - Visual: Happy reunion, cat purring

6. **Close (5-8s)**: Satisfying conclusion
   - Example: *"Now he's living his best life"*
   - Visual: Cat on couch with new owner

### Visual Style
- **Cinematic quality** with professional lighting
- **Anime-style expressions** for emotional moments
- **Dynamic camera motions**: slow zoom, pan, dolly shots
- **Meme-style subtitles**: White text, black outline, bottom placement
- **Emotional music**: Matches story mood (heartwarming, epic, funny)

### Caption Strategy
- **Mood-based hashtags**: #OrangeCat #CatsOfTikTok #EmotionalJourney
- **Call-to-action**: Engaging questions or statements
- **Archetype-specific tags**: #AdoptDontShop #GlowUp #OfficeLife

## 🎨 Story Archetypes

### RagsToRiches
From cardboard box to internet sensation - a classic transformation story.

### FromShelterToHome
Day 156 at the shelter... then everything changes.

### StreamerCatGlowUp
From Zoom bomb to streaming legend.

### VillainArcButSoft
Evil mastermind plots world domination (for treats).

### ChonkToBestFriend
Grumpy loner reluctantly becomes best friends with new kitten.

### OfficeHeroJourney
Office cat rises from mascot to Employee of the Month.

## 🔌 API Integration

### OpenAI API (Optional)

The `OpenAIStoryService` provides dynamic story generation:

- GPT-4-powered story creation
- Structured JSON output with scenes
- Automatic retry logic
- Scene timing optimization
- Creative variation based on archetypes

Uses OpenAI Chat Completions API with JSON mode for structured story output.

**Reference**: [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)

### Kling AI API

The project includes a complete `KlingClient` implementation with:

- Video creation requests
- Status polling with backoff
- Video download
- Error handling

**Placeholder endpoints** (update based on actual Kling documentation):
- `POST /v1/videos` - Create video job
- `GET /v1/videos/:jobId` - Get status
- Video download from returned URL

### TikTok API

The `TikTokClient` implements the TikTok Content Posting API flow:

- Initialize upload
- Upload video file
- Publish with metadata

**Reference**: [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started)

Requires OAuth 2.0 access token with `video.upload` scope.

## 🔑 API Setup Guide

### Getting OpenAI API Key (Optional)

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to **API Keys** section
4. Click **"Create new secret key"**
5. Copy the key (starts with `sk-...`)
6. Add to `.env`: `OPENAI_API_KEY=sk-your-key-here`

**Cost**: ~$0.01-0.03 per story generation with GPT-4o

### Getting Kling AI API Key

1. Visit [Kling AI Platform](https://kling.ai) (or contact their sales team)
2. Create an account and verify email
3. Navigate to **Developer** or **API Access** section
4. Generate an API key
5. Copy the key
6. Add to `.env`: `KLING_API_KEY=your-kling-key-here`

**Note**: Kling API may require application approval and has usage limits. Check their documentation for current pricing.

### Getting TikTok API Credentials

TikTok Content Posting API requires developer approval:

1. Go to [TikTok Developers](https://developers.tiktok.com/)
2. Register as a developer
3. Create a new app
4. Apply for **Content Posting API** access
5. Complete the review process (may take 1-2 weeks)
6. Once approved, generate OAuth 2.0 access token with `video.upload` scope
7. Add to `.env`: `TIKTOK_API_KEY=your-access-token-here`

**Important**:
- TikTok API access is restricted to approved developers
- Test in sandbox environment first
- Rate limits apply (see [TikTok API docs](https://developers.tiktok.com/doc/content-posting-api-get-started))

### Quick Setup Checklist

- [ ] Install Node.js 20+
- [ ] Clone repository
- [ ] Run `npm install`
- [ ] Copy `.env.example` to `.env`
- [ ] Add OpenAI API key (optional)
- [ ] Add Kling AI API key (required)
- [ ] Add TikTok access token (required)
- [ ] Run `npm run build`
- [ ] Test with `npm start -- --dry`
- [ ] Run first production attempt with `npm start`

## ⚙️ Configuration

All settings are managed via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | (optional) |
| `OPENAI_MODEL` | OpenAI model to use | `gpt-4o` |
| `USE_OPENAI_STORIES` | Enable OpenAI story generation | `true` |
| `KLING_API_KEY` | Kling AI API key | (required) |
| `KLING_BASE_URL` | Kling API base URL | `https://api.kling.ai` |
| `TIKTOK_API_KEY` | TikTok OAuth token | (required) |
| `TIKTOK_BASE_URL` | TikTok API base URL | `https://open.tiktokapis.com` |
| `VIDEO_DURATION_SECONDS` | Target video duration | `55` |
| `MAX_POLL_ATTEMPTS` | Max polling attempts | `60` |
| `POLL_INTERVAL_MS` | Polling interval | `10000` |
| `TIKTOK_VISIBILITY` | Video visibility | `public` |
| `VIDEO_DOWNLOAD_PATH` | Download directory | `/tmp/oc-mill-videos` |
| `RUN_INTERVAL_HOURS` | Loop mode interval | `24` |
| `LOG_LEVEL` | Logging level | `info` |

## 📝 Logging

The agent uses Winston for structured logging:

- Console output with colors
- File logging (`logs/combined.log`, `logs/error.log`)
- Automatic log directory creation
- Configurable log levels

## 🧪 Development

### Type Checking

```bash
npm run type-check
```

### Watch Mode

```bash
npm run watch
```

### Development Mode

```bash
npm run dev
```

### Clean Build

```bash
npm run clean
npm run build
```

## 🎯 Usage Examples

### Single Run

```bash
npm start
```

### Dry Run (Testing)

Test story generation and prompt building without API calls:

```bash
npm start -- --dry
```

This will output:
- Generated story (JSON)
- Kling prompt (text)
- TikTok caption (text)

### Batch Processing

Generate and publish 5 videos:

```bash
npm start -- --count 5
```

### Scheduled Publishing

Run every 24 hours automatically:

```bash
npm start -- --loop
```

Configure interval via `RUN_INTERVAL_HOURS` in `.env`.

### View Statistics

View detailed performance metrics and success rates:

```bash
npm start -- --stats
```

This displays:
- Total runs (successful/failed)
- Success rate
- Average duration
- Story generation method breakdown
- Archetype distribution
- Recent runs with timestamps

Statistics are persisted to `logs/statistics.json`.

### Example Statistics Report

```
═══════════════════════════════════════════════════
           OC-Mill Statistics Report
═══════════════════════════════════════════════════

Total Runs: 45
  ✓ Successful: 42 (93.3%)
  ✗ Failed: 3 (6.7%)

Average Duration: 6m 23s

Story Generation Methods:
  • OpenAI: 38 runs (84.4%)
  • Templates: 7 runs (15.6%)

Archetype Distribution:
  • StreamerCatGlowUp: 12 runs
  • RagsToRiches: 10 runs
  • FromShelterToHome: 9 runs
  • ChonkToBestFriend: 7 runs
  • VillainArcButSoft: 4 runs
  • OfficeHeroJourney: 3 runs

Recent Runs (last 5):
  1. ✓ 2026-02-18 10:30 | StreamerCatGlowUp | 6m 15s | OpenAI
  2. ✓ 2026-02-17 14:22 | RagsToRiches | 5m 48s | OpenAI
  3. ✗ 2026-02-17 09:15 | ChonkToBestFriend | 0m 45s | Failed (Kling timeout)
  4. ✓ 2026-02-16 18:30 | FromShelterToHome | 6m 02s | Templates
  5. ✓ 2026-02-16 12:45 | VillainArcButSoft | 7m 11s | OpenAI

═══════════════════════════════════════════════════
```

## 💰 Cost Estimation

Understanding the costs involved in running OC-Mill:

### Per-Video Costs

| Service | Cost per Video | Notes |
|---------|---------------|-------|
| **OpenAI GPT-4o** | $0.01 - $0.03 | Story generation only, ~1000-3000 tokens |
| **Kling AI** | $0.50 - $2.00 | Varies by video length and quality tier |
| **TikTok API** | Free | No direct costs, but rate limited |
| **Total (with OpenAI)** | **$0.51 - $2.03** | Per video |
| **Total (Templates)** | **$0.50 - $2.00** | Per video |

### Monthly Cost Examples

**Light Usage** (1 video/day, templates):
- 30 videos/month × $0.50 = **$15/month**

**Medium Usage** (3 videos/day, OpenAI):
- 90 videos/month × $0.75 (avg) = **$67.50/month**

**Heavy Usage** (10 videos/day, OpenAI):
- 300 videos/month × $0.75 (avg) = **$225/month**

### Cost Optimization Tips

1. **Use Templates**: Save $0.01-$0.03 per video by using `USE_OPENAI_STORIES=false`
2. **Batch Smartly**: Leverage rate limiting to avoid wasted API calls
3. **Monitor Failures**: Check `--stats` to identify and fix recurring issues
4. **Optimize Duration**: Shorter videos (30-45s) may cost less with Kling AI
5. **Test First**: Always use `--dry` mode when testing new configurations

**Note**: Kling AI pricing is estimated and may vary. Check their official pricing for accurate costs.

## 🔒 Security Notes

- Never commit `.env` file
- Store API keys securely
- Use environment variables in production
- **Built-in rate limiting** protects against API rate limit violations:
  - OpenAI: 10 tokens, refills at 0.5/sec (30/min)
  - Kling: 5 tokens, refills at 0.1/sec (6/min)
  - TikTok: 10 tokens, refills at 0.2/sec (12/min)
- Monitor API usage and costs via `--stats` command

## 🐛 Troubleshooting

### "Missing required environment variables"

Ensure `.env` file exists with `KLING_API_KEY` and `TIKTOK_API_KEY`.

### Video generation timeout

Increase `MAX_POLL_ATTEMPTS` or `POLL_INTERVAL_MS` in `.env`.

### TikTok upload fails

- Verify OAuth token is valid and has `video.upload` scope
- Check video file size limits (max 287.6 MB for TikTok)
- Ensure video is in correct format (MP4, 9:16)

### API rate limiting

The agent includes **built-in token bucket rate limiting** for all APIs:
- Automatically waits when rate limits are approached
- No manual intervention needed
- Logs wait times when rate limiting is active

If you need to adjust limits, modify `src/utils/RateLimiter.ts`:
```typescript
this.openai = new RateLimiter(maxTokens, refillRate);
```

### Video validation failures

If video validation fails, check:
- File size is between 500KB and 500MB
- Video file is readable and not corrupted
- File has `.mp4` extension
- Generated video matches expected duration

## 📊 Monitoring

The agent provides comprehensive monitoring capabilities:

### Logs

Stored in `logs/` directory:
- `combined.log` - All logs with timestamps
- `error.log` - Error logs only
- `statistics.json` - Performance metrics and run history

### Statistics Tracking

Automatically tracks:
- **Success/failure rates** for each run
- **Story generation method** (OpenAI vs Templates)
- **Archetype distribution** across runs
- **Video sizes** and validation results
- **Run duration** and performance metrics
- **TikTok post IDs** and share URLs

View statistics with:
```bash
npm start -- --stats
```

### Video Validation

Each video is validated before upload:
- ✓ File exists and is readable
- ✓ File size within limits (500KB - 500MB)
- ✓ Correct format (.mp4)
- ✓ Size appropriate for duration
- ⚠ Warnings for unusual file sizes

### Production Monitoring

For production deployments, monitor:
1. `logs/error.log` for failures
2. `logs/statistics.json` for success rates
3. API rate limiting messages in logs
4. Video validation failures

## 🚀 Production Deployment

### Docker (Recommended)

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .
RUN npm run build

CMD ["npm", "start", "--", "--loop"]
```

Build and run:

```bash
docker build -t oc-mill .
docker run -d --env-file .env oc-mill
```

### PM2

```bash
npm install -g pm2
pm2 start dist/index.js --name oc-mill
```

### Systemd Service

Create `/etc/systemd/system/oc-mill.service`:

```ini
[Unit]
Description=OC-Mill Orange Cat Agent
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/opt/oc-mill
ExecStart=/usr/bin/node dist/index.js --loop
Restart=on-failure
EnvironmentFile=/opt/oc-mill/.env

[Install]
WantedBy=multi-user.target
```

## ❓ FAQ

### General Questions

**Q: Do I need all three API keys?**
A: No. OpenAI is optional (you can use templates). You only need Kling AI and TikTok API keys.

**Q: Can I use this for other types of content besides orange cats?**
A: Yes! The architecture is modular. Modify the story archetypes and prompts in `src/story/archetypes.ts` and `src/services/OpenAIStoryService.ts`.

**Q: How long does it take to generate one video?**
A: Typically 5-8 minutes end-to-end:
- Story generation: 5-30 seconds
- Kling video generation: 4-7 minutes
- TikTok upload: 30-60 seconds

**Q: Can I run this on a Raspberry Pi?**
A: Yes, but it will be slower. Requires Node.js 20+. ARM builds of Node.js work fine.

### Troubleshooting

**Q: Why do my videos keep failing validation?**
A: Check:
- Kling AI is actually completing the video
- Downloaded file isn't corrupted (check file size > 500KB)
- Network connection is stable during download

**Q: Can I customize the video style?**
A: Yes! Edit `src/prompt/KlingPromptBuilder.ts` to modify the visual style, camera angles, and aesthetic.

**Q: How do I add new story archetypes?**
A: Edit `src/story/archetypes.ts` and add new templates following the existing structure.

**Q: What if I hit API rate limits?**
A: The built-in rate limiter handles this automatically. If you still hit limits, adjust the refill rates in `src/utils/RateLimiter.ts`.

### Advanced Usage

**Q: Can I run multiple agents in parallel?**
A: Yes, but be careful with rate limits. Each agent instance should use its own video download directory.

**Q: How do I backup my statistics?**
A: Copy `logs/statistics.json` periodically or use a cronjob to backup the entire `logs/` directory.

**Q: Can I customize the TikTok posting schedule?**
A: Yes! Set `RUN_INTERVAL_HOURS` in `.env` for loop mode, or use cron to schedule specific times.

**Q: Does this work with TikTok business accounts?**
A: Yes, as long as your OAuth token has the correct scopes for the account type.

**Q: Can I preview videos before uploading?**
A: Use `--dry` mode to generate the story and prompt, then manually create the video to preview. For automated flows, videos are in `VIDEO_DOWNLOAD_PATH`.

### Performance

**Q: How many videos can I generate per day?**
A: Limited by:
- Kling AI rate limits (~6/min with default settings)
- TikTok posting limits (check TikTok API docs)
- Your budget
- Realistically: 50-100 videos/day with proper rate limiting

**Q: Why is the success rate in my stats below 95%?**
A: Common causes:
- Kling AI timeouts (increase `MAX_POLL_ATTEMPTS`)
- Network issues during video download
- TikTok API temporary errors (agent will log details)

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 🙏 Acknowledgments

- Kling AI for text-to-video generation
- TikTok for content platform
- All the chubby orange cats of the internet

---

**Made with 🧡 for fat orange cats everywhere**
