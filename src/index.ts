#!/usr/bin/env node

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { dirname } from 'path';
import { OrangeCatAgent } from './agent/OrangeCatAgent';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { Story } from './story/types';

const execFileAsync = promisify(execFile);

/**
 * Verify ffmpeg is available — required by the Phase 4 compositor.
 * Logs a warning rather than throwing so dry runs still work without it.
 */
async function checkFfmpeg(): Promise<void> {
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version']);
    const firstLine = stdout.split('\n')[0];
    logger.info('ffmpeg available', { version: firstLine });
  } catch (err) {
    logger.warn(
      'ffmpeg not found on PATH — required for video composition (Phase 4). ' +
        'Install ffmpeg before running runOnce.',
      { error: err instanceof Error ? err.message : String(err) }
    );
  }
}

/**
 * Main entry point for the OC-mill agent.
 *
 * Usage:
 *   npm start                                       Run once
 *   npm start -- --dry                              LLM-only dry run
 *   npm start -- --stats                            Show statistics
 *   npm start -- --count N                          Run N times sequentially
 *   npm start -- --loop                             Run continuously
 *   npm start -- --scene N --story-file story.json  Regenerate one scene
 */

type Args =
  | { mode: 'once'; count?: number }
  | { mode: 'dry' }
  | { mode: 'loop' }
  | { mode: 'stats' }
  | { mode: 'scene'; sceneIndex: number; storyFile: string };

function parseArgs(): Args {
  const args = process.argv.slice(2);

  if (args.includes('--stats') || args.includes('-s')) return { mode: 'stats' };
  if (args.includes('--dry') || args.includes('-d')) return { mode: 'dry' };
  if (args.includes('--loop') || args.includes('-l')) return { mode: 'loop' };

  const sceneIdx = args.findIndex((a) => a === '--scene');
  if (sceneIdx !== -1 && args[sceneIdx + 1]) {
    const n = parseInt(args[sceneIdx + 1], 10);
    const fileIdx = args.findIndex((a) => a === '--story-file');
    const storyFile = fileIdx !== -1 ? args[fileIdx + 1] : undefined;
    if (Number.isNaN(n) || n < 0) {
      throw new Error('--scene requires a non-negative integer');
    }
    if (!storyFile) {
      throw new Error('--scene requires --story-file <path.json>');
    }
    return { mode: 'scene', sceneIndex: n, storyFile };
  }

  const countIndex = args.findIndex((arg) => arg === '--count' || arg === '-c');
  if (countIndex !== -1 && args[countIndex + 1]) {
    const count = parseInt(args[countIndex + 1], 10);
    if (!isNaN(count) && count > 0) {
      return { mode: 'once', count };
    }
  }

  return { mode: 'once' };
}

async function runScene(
  agent: OrangeCatAgent,
  storyFile: string,
  sceneIndex: number
): Promise<void> {
  logger.info('Regenerating single scene', { storyFile, sceneIndex });
  const raw = await readFile(storyFile, 'utf-8');
  const story = JSON.parse(raw) as Story;

  const outputDir = dirname(storyFile);
  const result = await agent.regenerateScene({ story, sceneIndex, outputDir });

  console.log('\n✅ Scene regenerated');
  console.log(`Keyframe: ${result.keyframe.path}`);
  console.log(`Clip:     ${result.clip.path}`);
  console.log(`Narration: ${result.narration.path}`);
}

/**
 * Run agent once
 */
async function runOnce(agent: OrangeCatAgent): Promise<void> {
  logger.info('Starting single run');

  const result = await agent.runOnce();

  if (result.success) {
    logger.info('Run completed successfully', {
      archetype: result.story.archetype,
      tiktokUrl: result.tiktokShareUrl,
      duration: `${(result.duration / 1000).toFixed(1)}s`,
    });

    console.log('\n✅ SUCCESS!');
    console.log(`Story: ${result.story.title}`);
    console.log(`TikTok Post ID: ${result.tiktokPostId}`);
    if (result.tiktokShareUrl) {
      console.log(`Share URL: ${result.tiktokShareUrl}`);
    }
  } else {
    logger.error('Run failed', { error: result.error });
    console.log('\n❌ FAILED!');
    console.log(`Error: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Run agent multiple times
 */
async function runMultiple(agent: OrangeCatAgent, count: number): Promise<void> {
  logger.info(`Starting ${count} runs`);

  const results = await agent.runMultiple(count);

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\n📊 Results: ${successful}/${count} successful`);

  if (failed > 0) {
    logger.warn(`${failed} runs failed`);
  }
}

/**
 * Run agent in dry mode (LLM stage only)
 */
async function runDry(agent: OrangeCatAgent): Promise<void> {
  logger.info('Starting dry run');

  const result = await agent.dryRun();

  console.log('\n✅ Dry run completed');
  console.log(`Story archetype: ${result.story.archetype}`);
  console.log(`Story title: ${result.story.title}`);
  console.log(`Scenes: ${result.story.scenes.length}`);
  console.log(`Caption length: ${result.caption.length} chars`);
}

/**
 * Show statistics
 */
async function showStats(agent: OrangeCatAgent): Promise<void> {
  logger.info('Displaying statistics');

  const report = agent.getStatisticsReport();
  console.log('\n' + report);

  console.log('\nFor detailed statistics, check logs/statistics.json');
}

/**
 * Run agent in loop mode with scheduling
 */
async function runLoop(agent: OrangeCatAgent): Promise<void> {
  const intervalHours = config.scheduling.runIntervalHours;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  logger.info('Starting loop mode', {
    intervalHours,
    intervalMs,
  });

  console.log(`\n🔄 Loop mode activated`);
  console.log(`Running every ${intervalHours} hours`);
  console.log(`Press Ctrl+C to stop\n`);

  // Run immediately on start
  await runOnce(agent);

  // Set up interval
  const interval = setInterval(async () => {
    logger.info('Scheduled run starting');
    await runOnce(agent);
  }, intervalMs);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully');
    clearInterval(interval);
    console.log('\n👋 Stopped. Goodbye!');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    clearInterval(interval);
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {}); // Never resolves
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // Print banner
    console.log('╔══════════════════════════════════════╗');
    console.log('║   🐱 OC-MILL - Orange Cat Agent 🐱   ║');
    console.log('║   Automated AI Cat Story TikToks    ║');
    console.log('╚══════════════════════════════════════╝\n');

    logger.info('Application starting', {
      nodeVersion: process.version,
      platform: process.platform,
      env: process.env.NODE_ENV || 'development',
    });

    // Verify ffmpeg (warning only — dry runs work without it)
    await checkFfmpeg();

    // Initialize agent
    const agent = new OrangeCatAgent(config);
    await agent.initialize();

    // Parse arguments and run
    const parsed = parseArgs();
    logger.info('Running in mode', { mode: parsed.mode });

    switch (parsed.mode) {
      case 'stats':
        await showStats(agent);
        break;

      case 'dry':
        await runDry(agent);
        break;

      case 'loop':
        await runLoop(agent);
        break;

      case 'scene':
        await runScene(agent, parsed.storyFile, parsed.sceneIndex);
        break;

      case 'once':
      default:
        if (parsed.count && parsed.count > 1) {
          await runMultiple(agent, parsed.count);
        } else {
          await runOnce(agent);
        }
        break;
    }

    // Cleanup
    agent.shutdown();

    logger.info('Application finished successfully');
  } catch (error) {
    logger.error('Application failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

export { OrangeCatAgent, config };
