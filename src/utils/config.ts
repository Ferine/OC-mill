import dotenv from 'dotenv';
import { logger } from './logger';

// Load environment variables from .env file
dotenv.config();

/**
 * Configuration interface for the entire application
 * All values loaded from environment variables with sensible defaults
 */
export interface Config {
  kling: {
    apiKey: string;
    baseUrl: string;
    videoDurationSeconds: number;
    aspectRatio: '9:16';
    maxPollAttempts: number;
    pollIntervalMs: number;
  };
  tiktok: {
    apiKey: string;
    baseUrl: string;
    visibility: 'public' | 'friends' | 'private';
  };
  video: {
    downloadPath: string;
  };
  scheduling: {
    runIntervalHours: number;
    autoRun: boolean;
  };
  logging: {
    level: string;
  };
}

/**
 * Validates that required environment variables are present
 */
function validateEnv(): void {
  const required = ['KLING_API_KEY', 'TIKTOK_API_KEY'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error('Missing required environment variables:', { missing });
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

/**
 * Loads and validates configuration from environment variables
 */
export function loadConfig(): Config {
  validateEnv();

  const config: Config = {
    kling: {
      apiKey: process.env.KLING_API_KEY!,
      baseUrl: process.env.KLING_BASE_URL || 'https://api.kling.ai',
      videoDurationSeconds: parseInt(
        process.env.VIDEO_DURATION_SECONDS || '55',
        10
      ),
      aspectRatio: '9:16',
      maxPollAttempts: parseInt(process.env.MAX_POLL_ATTEMPTS || '60', 10),
      pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000', 10),
    },
    tiktok: {
      apiKey: process.env.TIKTOK_API_KEY!,
      baseUrl:
        process.env.TIKTOK_BASE_URL || 'https://open.tiktokapis.com',
      visibility: (process.env.TIKTOK_VISIBILITY as any) || 'public',
    },
    video: {
      downloadPath:
        process.env.VIDEO_DOWNLOAD_PATH || '/tmp/oc-mill-videos',
    },
    scheduling: {
      runIntervalHours: parseInt(
        process.env.RUN_INTERVAL_HOURS || '24',
        10
      ),
      autoRun: process.env.AUTO_RUN === 'true',
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
    },
  };

  logger.info('Configuration loaded successfully', {
    klingBaseUrl: config.kling.baseUrl,
    tiktokBaseUrl: config.tiktok.baseUrl,
    videoDuration: config.kling.videoDurationSeconds,
    autoRun: config.scheduling.autoRun,
  });

  return config;
}

// Export singleton instance
export const config = loadConfig();
