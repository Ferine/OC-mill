import { logger } from './logger';

/**
 * Token bucket for rate limiting
 */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * RateLimiter protects against exceeding API rate limits
 * Uses token bucket algorithm for smooth rate limiting
 */
export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private maxTokens: number;
  private refillRate: number; // tokens per second
  private refillInterval: NodeJS.Timeout | null = null;

  constructor(maxTokens: number = 10, refillRate: number = 1) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;

    // Start refill timer
    this.startRefill();

    logger.info('RateLimiter initialized', {
      maxTokens,
      refillRate: `${refillRate}/s`,
    });
  }

  /**
   * Attempt to consume tokens for the given key. Refills lazily on each
   * call so we don't depend on the background timer firing in time.
   * Returns true if allowed, false if rate limited.
   */
  public async tryConsume(key: string, tokens: number = 1): Promise<boolean> {
    const bucket = this.getBucket(key);
    this.refillBucket(bucket);

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      logger.debug('Rate limit check passed', {
        key,
        tokensConsumed: tokens,
        tokensRemaining: bucket.tokens,
      });
      return true;
    }

    return false;
  }

  /**
   * Wait until tokens are available, then consume.
   */
  public async consume(key: string, tokens: number = 1): Promise<void> {
    while (!(await this.tryConsume(key, tokens))) {
      const bucket = this.getBucket(key);
      const tokensNeeded = Math.max(0, tokens - bucket.tokens);
      // Wait long enough for refill to actually yield the missing tokens.
      // Floor at 100ms so we don't busy-loop on rounding artifacts.
      const waitMs = Math.max(100, Math.ceil((tokensNeeded / this.refillRate) * 1000));
      logger.info('Waiting for rate limit to refill', {
        key,
        waitMs,
        tokensNeeded,
      });
      await this.sleep(waitMs);
    }
  }

  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    if (elapsed <= 0) return;
    const add = elapsed * this.refillRate;
    if (add > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + add);
      bucket.lastRefill = now;
    }
  }

  /**
   * Get current token count for a key
   */
  public getTokens(key: string): number {
    return this.getBucket(key).tokens;
  }

  /**
   * Reset tokens for a key
   */
  public reset(key: string): void {
    const bucket = this.getBucket(key);
    bucket.tokens = this.maxTokens;
    logger.info('Rate limiter reset', { key, tokens: this.maxTokens });
  }

  /**
   * Reset all rate limiters
   */
  public resetAll(): void {
    this.buckets.clear();
    logger.info('All rate limiters reset');
  }

  /**
   * Stop the refill timer
   */
  public stop(): void {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = null;
      logger.info('RateLimiter stopped');
    }
  }

  /**
   * Get or create bucket for key
   */
  private getBucket(key: string): TokenBucket {
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.maxTokens,
        lastRefill: Date.now(),
      };
      this.buckets.set(key, bucket);
    }

    return bucket;
  }

  /**
   * Start automatic token refill
   */
  private startRefill(): void {
    // Refill every second
    this.refillInterval = setInterval(() => {
      const now = Date.now();

      for (const [key, bucket] of this.buckets.entries()) {
        const timeSinceRefill = (now - bucket.lastRefill) / 1000;
        const tokensToAdd = timeSinceRefill * this.refillRate;

        if (tokensToAdd > 0) {
          bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
          bucket.lastRefill = now;

          logger.debug('Tokens refilled', {
            key,
            tokensAdded: tokensToAdd.toFixed(2),
            tokensNow: bucket.tokens.toFixed(2),
          });
        }
      }
    }, 1000);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Per-vendor rate limiters. Tunable via constructor; defaults are conservative.
 */
export class APIRateLimiters {
  public readonly openrouterLLM: RateLimiter;
  public readonly openrouterImage: RateLimiter;
  public readonly openrouterVideo: RateLimiter;
  public readonly tts: RateLimiter;
  public readonly tiktok: RateLimiter;

  constructor() {
    this.openrouterLLM = new RateLimiter(10, 0.5);
    this.openrouterImage = new RateLimiter(8, 0.3);
    this.openrouterVideo = new RateLimiter(5, 0.1);
    this.tts = new RateLimiter(10, 0.5);
    this.tiktok = new RateLimiter(10, 0.2);

    logger.info('API Rate limiters initialized');
  }

  public stopAll(): void {
    this.openrouterLLM.stop();
    this.openrouterImage.stop();
    this.openrouterVideo.stop();
    this.tts.stop();
    this.tiktok.stop();
  }

  public resetAll(): void {
    this.openrouterLLM.resetAll();
    this.openrouterImage.resetAll();
    this.openrouterVideo.resetAll();
    this.tts.resetAll();
    this.tiktok.resetAll();
  }
}
