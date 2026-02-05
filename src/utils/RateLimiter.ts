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
   * Attempt to consume a token for the given key
   * Returns true if allowed, false if rate limited
   */
  public async tryConsume(key: string, tokens: number = 1): Promise<boolean> {
    const bucket = this.getBucket(key);

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      logger.debug('Rate limit check passed', {
        key,
        tokensConsumed: tokens,
        tokensRemaining: bucket.tokens,
      });
      return true;
    }

    logger.warn('Rate limit exceeded', {
      key,
      tokensRequested: tokens,
      tokensAvailable: bucket.tokens,
    });
    return false;
  }

  /**
   * Wait until tokens are available, then consume
   */
  public async consume(key: string, tokens: number = 1): Promise<void> {
    while (!(await this.tryConsume(key, tokens))) {
      // Calculate wait time
      const bucket = this.getBucket(key);
      const tokensNeeded = tokens - bucket.tokens;
      const waitMs = (tokensNeeded / this.refillRate) * 1000;

      logger.info('Waiting for rate limit to refill', {
        key,
        waitMs: Math.ceil(waitMs),
        tokensNeeded,
      });

      await this.sleep(Math.ceil(waitMs));
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
 * Global rate limiters for different APIs
 */
export class APIRateLimiters {
  public readonly openai: RateLimiter;
  public readonly kling: RateLimiter;
  public readonly tiktok: RateLimiter;

  constructor() {
    // OpenAI: Conservative limits (adjust based on your tier)
    this.openai = new RateLimiter(10, 0.5); // 10 tokens, refill 0.5/sec (30/min)

    // Kling: Moderate limits (adjust based on API docs)
    this.kling = new RateLimiter(5, 0.1); // 5 tokens, refill 0.1/sec (6/min)

    // TikTok: Conservative limits (adjust based on API docs)
    this.tiktok = new RateLimiter(10, 0.2); // 10 tokens, refill 0.2/sec (12/min)

    logger.info('API Rate limiters initialized');
  }

  /**
   * Stop all rate limiters
   */
  public stopAll(): void {
    this.openai.stop();
    this.kling.stop();
    this.tiktok.stop();
  }

  /**
   * Reset all rate limiters
   */
  public resetAll(): void {
    this.openai.resetAll();
    this.kling.resetAll();
    this.tiktok.resetAll();
  }
}
