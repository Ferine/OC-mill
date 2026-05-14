import { Story } from '../story/types';
import { Brand } from '../brand/types';
import { logger } from '../utils/logger';

/**
 * Generates TikTok captions (opening line + body highlights + CTA + hashtags)
 * from a finished story and the brand that produced it. All brand-flavored
 * material — hashtags, openings, CTAs — comes from `brand.caption`.
 */
export class CaptionGenerator {
  public generateCaption(brand: Brand, story: Story): string {
    logger.info('Generating TikTok caption', {
      brandId: brand.id,
      archetypeId: story.archetypeId,
      mood: story.overallMood,
    });

    const parts = [
      this.getOpeningLine(brand, story.archetypeId),
      '',
      this.getCaptionBody(story),
      '',
      this.getClosingCTA(brand),
      '',
      this.generateHashtags(brand, story),
    ];

    const caption = parts.join('\n');

    logger.info('Caption generated', {
      length: caption.length,
      hashtags: (caption.match(/#\w+/g) || []).length,
    });

    return caption;
  }

  public generateShortCaption(brand: Brand, story: Story): string {
    const opening = this.getOpeningLine(brand, story.archetypeId);
    const hashtags = this.generateHashtags(brand, story, 5);
    return `${opening}\n\n${hashtags}`;
  }

  public generateHashtags(
    brand: Brand,
    story: Story,
    maxHashtags: number = 15
  ): string {
    const hashtags = new Set<string>();
    brand.caption.coreHashtags.forEach((t) => hashtags.add(t));
    (brand.caption.moodHashtags[story.overallMood] ?? []).forEach((t) =>
      hashtags.add(t)
    );
    (brand.caption.archetypeHashtags[story.archetypeId] ?? []).forEach((t) =>
      hashtags.add(t)
    );
    (brand.caption.trendingHashtags ?? []).forEach((t) => hashtags.add(t));

    return [...hashtags].slice(0, maxHashtags).join(' ');
  }

  public getHashtagsArray(
    brand: Brand,
    story: Story,
    maxHashtags: number = 15
  ): string[] {
    return this.generateHashtags(brand, story, maxHashtags).split(' ');
  }

  public generateCustomCaption(
    brand: Brand,
    story: Story,
    customOpening: string
  ): string {
    const parts = [
      customOpening,
      '',
      this.getCaptionBody(story),
      '',
      this.getClosingCTA(brand),
      '',
      this.generateHashtags(brand, story),
    ];
    return parts.join('\n');
  }

  public validateCaption(caption: string): {
    valid: boolean;
    length: number;
    maxLength: number;
    warnings: string[];
  } {
    const maxLength = 2200;
    const warnings: string[] = [];
    if (caption.length > maxLength) {
      warnings.push(
        `Caption exceeds ${maxLength} characters (${caption.length})`
      );
    }
    const hashtagCount = (caption.match(/#\w+/g) || []).length;
    if (hashtagCount > 30) {
      warnings.push(`Too many hashtags (${hashtagCount}), recommend max 20`);
    }
    return {
      valid: caption.length <= maxLength,
      length: caption.length,
      maxLength,
      warnings,
    };
  }

  private getOpeningLine(brand: Brand, archetypeId: string): string {
    const options =
      brand.caption.archetypeOpenings[archetypeId] ??
      brand.caption.closingCtas;
    return this.randomChoice(options);
  }

  private getCaptionBody(story: Story): string {
    const keyScenes = this.getKeyScenes(story);
    if (keyScenes.length === 0) return story.narrative;
    return keyScenes.map((s) => `✨ ${s.subtitleText}`).join('\n');
  }

  private getKeyScenes(story: Story): Array<{ subtitleText: string }> {
    const scenes = story.scenes;
    if (scenes.length <= 3) return scenes;
    const indices = [0, Math.floor(scenes.length / 2), scenes.length - 1];
    return indices.map((i) => scenes[i]);
  }

  private getClosingCTA(brand: Brand): string {
    return this.randomChoice(brand.caption.closingCtas);
  }

  private randomChoice<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }
}
