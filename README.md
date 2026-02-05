# 🐱 OC-Mill - Orange Cat Story Agent

**Automated AI-powered TikTok content generation for fat orange cat stories**

OC-Mill is a production-ready Node.js/TypeScript agent that automatically generates, produces, and publishes vertical video stories about a chubby orange cat to TikTok.

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
