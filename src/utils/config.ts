import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  llmModel: string;
  imageModel: string;
  videoModel: string;
  vlmModel: string;
  ttsModel: string;
  musicModel: string;
  appName: string;
  appUrl: string;
}

export interface MusicConfig {
  enabled: boolean;
  /** Music volume relative to narration, in dB. Negative = quieter. */
  volumeDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export interface TTSConfig {
  format: 'pcm' | 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
  voicesByMood: Record<string, string>;
}

export interface PipelineConfig {
  videoDurationSeconds: number;
  aspectRatio: '9:16';
  clipDurationSeconds: number;
  sceneConcurrency: number;
  maxPollAttempts: number;
  pollIntervalMs: number;
  evalRetriesPerScene: number;
  characterRefDir: string;
  videoDownloadPath: string;
  brandsDir: string;
  defaultBrandId: string;
}

export interface TikTokConfig {
  apiKey: string;
  baseUrl: string;
  visibility: 'public' | 'friends' | 'private';
}

export interface SchedulingConfig {
  runIntervalHours: number;
  autoRun: boolean;
}

export interface Config {
  openrouter: OpenRouterConfig;
  tts: TTSConfig;
  music: MusicConfig;
  pipeline: PipelineConfig;
  tiktok: TikTokConfig;
  scheduling: SchedulingConfig;
  logging: { level: string };
}

function requireEnv(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.error('Missing required environment variables:', { missing });
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

export function loadConfig(): Config {
  requireEnv(['OPENROUTER_API_KEY', 'TIKTOK_API_KEY']);

  const config: Config = {
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      llmModel: process.env.OPENROUTER_LLM_MODEL || 'openai/gpt-5',
      imageModel: process.env.OPENROUTER_IMAGE_MODEL || 'openai/gpt-5.4-image-2',
      videoModel: process.env.OPENROUTER_VIDEO_MODEL || 'bytedance/seedance-2.0',
      vlmModel: process.env.OPENROUTER_VLM_MODEL || 'openai/gpt-5',
      ttsModel:
        process.env.OPENROUTER_TTS_MODEL || 'google/gemini-3.1-flash-tts-preview',
      musicModel:
        process.env.OPENROUTER_MUSIC_MODEL || 'google/lyria-3-pro-preview',
      appName: process.env.OPENROUTER_APP_NAME || 'oc-mill',
      appUrl: process.env.OPENROUTER_APP_URL || 'https://github.com/ferine/oc-mill',
    },
    tts: {
      // Gemini 3.1 Flash TTS only supports response_format=pcm. Other models
      // accept mp3 (the OpenAI Audio Speech default). Set OPENROUTER_TTS_FORMAT
      // when swapping models — the narration service wraps PCM in a WAV
      // header on save so it's playable everywhere.
      format:
        (process.env.OPENROUTER_TTS_FORMAT as TTSConfig['format']) || 'pcm',
      // Gemini 3.1 Flash TTS prebuilt voice names. Override any of these to
      // retune the brand voices. Other TTS models on OpenRouter will accept
      // their own voice IDs here (just swap OPENROUTER_TTS_MODEL too).
      voicesByMood: {
        heartwarming: process.env.TTS_VOICE_HEARTWARMING || 'Aoede',
        funny: process.env.TTS_VOICE_FUNNY || 'Puck',
        dramatic: process.env.TTS_VOICE_DRAMATIC || 'Charon',
        sad: process.env.TTS_VOICE_SAD || 'Leda',
        hopeful: process.env.TTS_VOICE_HOPEFUL || 'Kore',
        epic: process.env.TTS_VOICE_EPIC || 'Fenrir',
      },
    },
    music: {
      // Off by default — Lyria 3 Pro is ~$0.08/run. Set MUSIC_ENABLED=true
      // once the wire format has been confirmed against a real OpenRouter
      // response and you're happy with the per-run cost.
      enabled: process.env.MUSIC_ENABLED === 'true',
      volumeDb: parseFloat(process.env.MUSIC_VOLUME_DB || '-18'),
      fadeInSeconds: parseFloat(process.env.MUSIC_FADE_IN_SECONDS || '1.5'),
      fadeOutSeconds: parseFloat(process.env.MUSIC_FADE_OUT_SECONDS || '2'),
    },
    pipeline: {
      videoDurationSeconds: parseInt(process.env.VIDEO_DURATION_SECONDS || '55', 10),
      aspectRatio: '9:16',
      clipDurationSeconds: parseInt(process.env.CLIP_DURATION_SECONDS || '7', 10),
      sceneConcurrency: parseInt(process.env.SCENE_CONCURRENCY || '2', 10),
      maxPollAttempts: parseInt(process.env.MAX_POLL_ATTEMPTS || '120', 10),
      pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000', 10),
      evalRetriesPerScene: parseInt(process.env.EVAL_RETRIES_PER_SCENE || '1', 10),
      characterRefDir: process.env.CHARACTER_REF_DIR || '/tmp/oc-mill-character-refs',
      videoDownloadPath: process.env.VIDEO_DOWNLOAD_PATH || '/tmp/oc-mill-videos',
      brandsDir: process.env.BRANDS_DIR || './brands',
      defaultBrandId: process.env.DEFAULT_BRAND_ID || 'orange-cat',
    },
    tiktok: {
      apiKey: process.env.TIKTOK_API_KEY!,
      baseUrl: process.env.TIKTOK_BASE_URL || 'https://open.tiktokapis.com',
      visibility: (process.env.TIKTOK_VISIBILITY as TikTokConfig['visibility']) || 'public',
    },
    scheduling: {
      runIntervalHours: parseInt(process.env.RUN_INTERVAL_HOURS || '24', 10),
      autoRun: process.env.AUTO_RUN === 'true',
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
    },
  };

  logger.info('Configuration loaded', {
    llmModel: config.openrouter.llmModel,
    imageModel: config.openrouter.imageModel,
    videoModel: config.openrouter.videoModel,
    ttsModel: config.openrouter.ttsModel,
    musicModel: config.openrouter.musicModel,
    musicEnabled: config.music.enabled,
    sceneConcurrency: config.pipeline.sceneConcurrency,
    clipDurationSeconds: config.pipeline.clipDurationSeconds,
  });

  return config;
}

export const config = loadConfig();
