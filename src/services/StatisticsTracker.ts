import { logger } from '../utils/logger';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Statistics for a single run
 */
export interface RunStatistics {
  timestamp: string;
  success: boolean;
  archetype: string;
  storyGenerationMethod: 'OpenAI' | 'Templates';
  duration: number; // milliseconds
  klingJobId?: string;
  tiktokPostId?: string;
  tiktokShareUrl?: string;
  error?: string;
  videoSize?: number; // bytes
  sceneCount?: number;
}

/**
 * Aggregated statistics
 */
export interface AggregatedStatistics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
  averageDurationMs: number;
  archetypeDistribution: Record<string, number>;
  storyMethodDistribution: Record<string, number>;
  totalVideosGenerated: number;
  totalVideosSizeBytes: number;
  lastRun?: RunStatistics;
  firstRun?: RunStatistics;
}

/**
 * StatisticsTracker monitors agent performance and success metrics
 */
export class StatisticsTracker {
  private statsPath: string;
  private runs: RunStatistics[] = [];
  private maxStoredRuns: number;

  constructor(statsPath: string = 'logs/statistics.json', maxStoredRuns: number = 1000) {
    this.statsPath = statsPath;
    this.maxStoredRuns = maxStoredRuns;
  }

  /**
   * Initialize tracker and load existing statistics
   */
  public async initialize(): Promise<void> {
    try {
      // Ensure logs directory exists
      const dir = join(this.statsPath, '..');
      await mkdir(dir, { recursive: true });

      // Load existing stats if available
      if (existsSync(this.statsPath)) {
        const data = await readFile(this.statsPath, 'utf-8');
        this.runs = JSON.parse(data);
        logger.info('Statistics loaded', {
          totalRuns: this.runs.length,
          statsPath: this.statsPath,
        });
      } else {
        logger.info('No existing statistics found, starting fresh');
      }
    } catch (error) {
      logger.error('Failed to initialize statistics tracker', { error });
      // Continue with empty stats rather than failing
      this.runs = [];
    }
  }

  /**
   * Record a new run
   */
  public async recordRun(run: RunStatistics): Promise<void> {
    this.runs.push(run);

    // Trim old runs if exceeding max
    if (this.runs.length > this.maxStoredRuns) {
      this.runs = this.runs.slice(-this.maxStoredRuns);
    }

    await this.save();

    logger.info('Run recorded', {
      success: run.success,
      archetype: run.archetype,
      duration: run.duration,
      totalRuns: this.runs.length,
    });
  }

  /**
   * Get aggregated statistics
   */
  public getAggregatedStats(): AggregatedStatistics {
    if (this.runs.length === 0) {
      return {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        successRate: 0,
        averageDurationMs: 0,
        archetypeDistribution: {},
        storyMethodDistribution: {},
        totalVideosGenerated: 0,
        totalVideosSizeBytes: 0,
      };
    }

    const successfulRuns = this.runs.filter((r) => r.success);
    const failedRuns = this.runs.filter((r) => !r.success);

    // Calculate archetype distribution
    const archetypeDistribution: Record<string, number> = {};
    this.runs.forEach((run) => {
      archetypeDistribution[run.archetype] =
        (archetypeDistribution[run.archetype] || 0) + 1;
    });

    // Calculate story method distribution
    const storyMethodDistribution: Record<string, number> = {};
    this.runs.forEach((run) => {
      storyMethodDistribution[run.storyGenerationMethod] =
        (storyMethodDistribution[run.storyGenerationMethod] || 0) + 1;
    });

    // Calculate average duration
    const totalDuration = this.runs.reduce((sum, run) => sum + run.duration, 0);
    const averageDuration = totalDuration / this.runs.length;

    // Calculate total video size
    const totalVideoSize = successfulRuns.reduce(
      (sum, run) => sum + (run.videoSize || 0),
      0
    );

    return {
      totalRuns: this.runs.length,
      successfulRuns: successfulRuns.length,
      failedRuns: failedRuns.length,
      successRate: (successfulRuns.length / this.runs.length) * 100,
      averageDurationMs: averageDuration,
      archetypeDistribution,
      storyMethodDistribution,
      totalVideosGenerated: successfulRuns.length,
      totalVideosSizeBytes: totalVideoSize,
      lastRun: this.runs[this.runs.length - 1],
      firstRun: this.runs[0],
    };
  }

  /**
   * Get recent runs
   */
  public getRecentRuns(count: number = 10): RunStatistics[] {
    return this.runs.slice(-count);
  }

  /**
   * Get failed runs for debugging
   */
  public getFailedRuns(count: number = 10): RunStatistics[] {
    return this.runs.filter((r) => !r.success).slice(-count);
  }

  /**
   * Get statistics for a specific archetype
   */
  public getArchetypeStats(archetype: string): {
    totalRuns: number;
    successfulRuns: number;
    successRate: number;
    averageDurationMs: number;
  } {
    const archetypeRuns = this.runs.filter((r) => r.archetype === archetype);

    if (archetypeRuns.length === 0) {
      return {
        totalRuns: 0,
        successfulRuns: 0,
        successRate: 0,
        averageDurationMs: 0,
      };
    }

    const successfulRuns = archetypeRuns.filter((r) => r.success);
    const totalDuration = archetypeRuns.reduce((sum, r) => sum + r.duration, 0);

    return {
      totalRuns: archetypeRuns.length,
      successfulRuns: successfulRuns.length,
      successRate: (successfulRuns.length / archetypeRuns.length) * 100,
      averageDurationMs: totalDuration / archetypeRuns.length,
    };
  }

  /**
   * Get formatted statistics report
   */
  public getFormattedReport(): string {
    const stats = this.getAggregatedStats();

    const lines = [
      '═══════════════════════════════════════',
      '       OC-MILL STATISTICS REPORT       ',
      '═══════════════════════════════════════',
      '',
      `Total Runs: ${stats.totalRuns}`,
      `Successful: ${stats.successfulRuns} (${stats.successRate.toFixed(1)}%)`,
      `Failed: ${stats.failedRuns}`,
      `Average Duration: ${(stats.averageDurationMs / 1000).toFixed(1)}s`,
      '',
      '─── Story Generation Methods ───',
      ...Object.entries(stats.storyMethodDistribution).map(
        ([method, count]) => `${method}: ${count} runs`
      ),
      '',
      '─── Archetype Distribution ───',
      ...Object.entries(stats.archetypeDistribution)
        .sort(([, a], [, b]) => b - a)
        .map(([archetype, count]) => `${archetype}: ${count} runs`),
      '',
      `Total Videos Generated: ${stats.totalVideosGenerated}`,
      `Total Video Size: ${(stats.totalVideosSizeBytes / 1024 / 1024).toFixed(2)} MB`,
      '',
    ];

    if (stats.lastRun) {
      lines.push('─── Last Run ───');
      lines.push(`Time: ${new Date(stats.lastRun.timestamp).toLocaleString()}`);
      lines.push(`Archetype: ${stats.lastRun.archetype}`);
      lines.push(`Method: ${stats.lastRun.storyGenerationMethod}`);
      lines.push(`Success: ${stats.lastRun.success ? '✅' : '❌'}`);
      lines.push(`Duration: ${(stats.lastRun.duration / 1000).toFixed(1)}s`);
      if (stats.lastRun.tiktokShareUrl) {
        lines.push(`URL: ${stats.lastRun.tiktokShareUrl}`);
      }
    }

    lines.push('═══════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Save statistics to disk
   */
  private async save(): Promise<void> {
    try {
      await writeFile(this.statsPath, JSON.stringify(this.runs, null, 2));
    } catch (error) {
      logger.error('Failed to save statistics', { error });
    }
  }

  /**
   * Reset all statistics
   */
  public async reset(): Promise<void> {
    this.runs = [];
    await this.save();
    logger.info('Statistics reset');
  }

  /**
   * Export statistics to JSON
   */
  public exportToJSON(): string {
    return JSON.stringify(
      {
        aggregated: this.getAggregatedStats(),
        runs: this.runs,
      },
      null,
      2
    );
  }
}
