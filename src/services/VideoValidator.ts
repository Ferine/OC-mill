import { statSync, accessSync, constants } from 'fs';
import { logger } from '../utils/logger';

/**
 * Video validation results
 */
export interface VideoValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata: {
    filePath: string;
    exists: boolean;
    sizeBytes?: number;
    sizeMB?: number;
    readable?: boolean;
  };
}

/**
 * VideoValidator performs basic validation checks on generated videos
 *
 * Validates:
 * - File exists and is readable
 * - File size is reasonable (not corrupted/incomplete)
 * - Basic metadata checks
 *
 * Note: For full video validation (resolution, duration, codec), you would
 * need ffmpeg or similar tools. This provides lightweight checks.
 */
export class VideoValidator {
  private minSizeBytes: number;
  private maxSizeBytes: number;
  private targetDuration: number;

  constructor(
    targetDuration: number = 55,
    minSizeBytes: number = 500_000, // 500 KB minimum
    maxSizeBytes: number = 500_000_000 // 500 MB maximum
  ) {
    this.targetDuration = targetDuration;
    this.minSizeBytes = minSizeBytes;
    this.maxSizeBytes = maxSizeBytes;
  }

  /**
   * Validate a video file
   */
  public async validateVideo(filePath: string): Promise<VideoValidationResult> {
    logger.info('Validating video', { filePath });

    const result: VideoValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      metadata: {
        filePath,
        exists: false,
        readable: false,
      },
    };

    try {
      // Check 1: File exists
      result.metadata.exists = await this.checkFileExists(filePath);
      if (!result.metadata.exists) {
        result.errors.push('Video file does not exist');
        result.valid = false;
        return result;
      }

      // Check 2: File is readable
      result.metadata.readable = await this.checkFileReadable(filePath);
      if (!result.metadata.readable) {
        result.errors.push('Video file is not readable');
        result.valid = false;
        return result;
      }

      // Check 3: File size
      const stats = statSync(filePath);
      result.metadata.sizeBytes = stats.size;
      result.metadata.sizeMB = stats.size / (1024 * 1024);

      if (stats.size < this.minSizeBytes) {
        result.errors.push(
          `Video file too small (${result.metadata.sizeMB.toFixed(2)} MB). Likely corrupted or incomplete.`
        );
        result.valid = false;
      }

      if (stats.size > this.maxSizeBytes) {
        result.errors.push(
          `Video file too large (${result.metadata.sizeMB.toFixed(2)} MB). Exceeds maximum size.`
        );
        result.valid = false;
      }

      // Check 4: File extension
      if (!filePath.toLowerCase().endsWith('.mp4')) {
        result.warnings.push('Video file is not .mp4 format. May not be compatible with TikTok.');
      }

      // Check 5: Size warnings based on typical video sizes
      const expectedMinSize = this.estimateMinSize(this.targetDuration);
      if (stats.size < expectedMinSize) {
        result.warnings.push(
          `Video size (${result.metadata.sizeMB.toFixed(2)} MB) is smaller than expected for ${this.targetDuration}s video. Quality may be low.`
        );
      }

      logger.info('Video validation completed', {
        filePath,
        valid: result.valid,
        sizeBytes: result.metadata.sizeBytes,
        sizeMB: result.metadata.sizeMB,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
      });
    } catch (error) {
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
      result.valid = false;
      logger.error('Video validation failed', { filePath, error });
    }

    return result;
  }

  /**
   * Quick validation (just existence and readability)
   */
  public async quickValidate(filePath: string): Promise<boolean> {
    try {
      const exists = await this.checkFileExists(filePath);
      if (!exists) return false;

      const readable = await this.checkFileReadable(filePath);
      return readable;
    } catch {
      return false;
    }
  }

  /**
   * Check if file exists
   */
  private async checkFileExists(filePath: string): Promise<boolean> {
    try {
      statSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if file is readable
   */
  private async checkFileReadable(filePath: string): Promise<boolean> {
    try {
      accessSync(filePath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Estimate minimum expected file size based on duration
   * Assumes ~0.5 MB per second for 1080p video
   */
  private estimateMinSize(durationSeconds: number): number {
    return durationSeconds * 500_000; // 500 KB per second
  }

  /**
   * Get validation summary string
   */
  public getValidationSummary(result: VideoValidationResult): string {
    if (result.valid) {
      return `✅ Video valid (${result.metadata.sizeMB?.toFixed(2)} MB)`;
    }

    const parts = [
      `❌ Video invalid:`,
      ...result.errors.map((e) => `  - ${e}`),
    ];

    if (result.warnings.length > 0) {
      parts.push('⚠️  Warnings:');
      parts.push(...result.warnings.map((w) => `  - ${w}`));
    }

    return parts.join('\n');
  }
}

/**
 * Advanced video validation using ffprobe (requires ffmpeg installed)
 * This is a placeholder for future implementation
 */
export class AdvancedVideoValidator extends VideoValidator {
  /**
   * Validate video metadata using ffprobe
   *
   * This would check:
   * - Resolution (should be 1080x1920 for 9:16)
   * - Duration (should match target)
   * - Codec (should be H.264)
   * - Frame rate (should be 24-30 fps)
   *
   * Requires ffmpeg/ffprobe to be installed
   */
  public async validateWithFFProbe(filePath: string): Promise<VideoValidationResult> {
    // Placeholder for future implementation
    // Would exec ffprobe and parse JSON output
    logger.info('Advanced validation with ffprobe not yet implemented');
    return await this.validateVideo(filePath);
  }
}
