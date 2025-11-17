import { Story, ArchetypeName, Mood } from '../story/types';
import { logger } from '../utils/logger';

/**
 * CaptionGenerator creates engaging TikTok captions with hashtags
 * based on the story content and archetype
 */
export class CaptionGenerator {
  /**
   * Core hashtags always included
   */
  private readonly CORE_HASHTAGS = [
    '#aicat',
    '#orangecat',
    '#fatcat',
    '#chonk',
    '#catstory',
    '#aivideo',
  ];

  /**
   * Additional hashtags based on mood
   */
  private readonly MOOD_HASHTAGS: Record<Mood, string[]> = {
    sad: ['#emotional', '#wholesome', '#rescue'],
    hopeful: ['#inspiring', '#hopeful', '#secondchance'],
    funny: ['#funnycat', '#catmemes', '#comedy'],
    dramatic: ['#dramatic', '#epic', '#cinematic'],
    heartwarming: ['#wholesome', '#heartwarming', '#love'],
    epic: ['#epic', '#legend', '#hero'],
  };

  /**
   * Hashtags based on story archetype
   */
  private readonly ARCHETYPE_HASHTAGS: Record<ArchetypeName, string[]> = {
    RagsToRiches: ['#transformation', '#glowup', '#success'],
    FromShelterToHome: ['#adoptdontshop', '#rescue', '#shelter'],
    StreamerCatGlowUp: ['#gaming', '#streamer', '#gamer'],
    VillainArcButSoft: ['#villain', '#comedy', '#mischief'],
    ChonkToBestFriend: ['#friendship', '#bond', '#love'],
    OfficeHeroJourney: ['#officecat', '#worklife', '#hero'],
  };

  /**
   * Opening lines based on archetype
   */
  private readonly OPENING_LINES: Record<ArchetypeName, string[]> = {
    RagsToRiches: [
      'From cardboard box to internet sensation 📦→⭐',
      'This chonky boy went from zero to hero 🧡',
      'The ultimate glow-up story 😺✨',
    ],
    FromShelterToHome: [
      'Day 156 at the shelter... then everything changed 🏠',
      'Nobody wanted this chonk, until someone did 💛',
      'Every shelter cat deserves their moment 🐱',
    ],
    StreamerCatGlowUp: [
      'From Zoom bomb to streaming legend 🎮',
      'When your cat becomes the real content 📹',
      'This orange chonk just hit 100k subs 🚀',
    ],
    VillainArcButSoft: [
      'Evil mastermind or just hungry? You decide 😈',
      'Watch this cat plot world domination (for treats) 🌍',
      'The softest villain arc ever told 🦹',
    ],
    ChonkToBestFriend: [
      'From grumpy loner to best friends 👯',
      'When the chonk finds his person (or kitten) 💕',
      'The friendship nobody asked for but everyone needed 🐾',
    ],
    OfficeHeroJourney: [
      'Office cat saves the day 🦸',
      'From backpack to employee of the month 💼',
      'This chonk is now Chief Morale Officer 📊',
    ],
  };

  /**
   * Closing CTAs (Call to Action)
   */
  private readonly CLOSING_CTAS = [
    'Follow for more orange cat content! 🧡',
    'Part 2? 👀',
    'Like if you love this chonk! ❤️',
    'Share with a cat lover! 🐱',
    'Tag someone who needs to see this 👇',
    'More stories coming soon! 🎬',
  ];

  /**
   * Generate a complete TikTok caption for a story
   */
  public generateCaption(story: Story): string {
    logger.info('Generating TikTok caption', {
      archetype: story.archetype,
      mood: story.overallMood,
    });

    const parts = [
      this.getOpeningLine(story.archetype),
      '',
      this.getCaptionBody(story),
      '',
      this.getClosingCTA(),
      '',
      this.generateHashtags(story),
    ];

    const caption = parts.join('\n');

    logger.info('Caption generated', {
      length: caption.length,
      hashtags: (caption.match(/#\w+/g) || []).length,
    });

    return caption;
  }

  /**
   * Generate a short caption (for character limits)
   */
  public generateShortCaption(story: Story): string {
    const opening = this.getOpeningLine(story.archetype);
    const hashtags = this.generateHashtags(story, 5); // Limit hashtags

    return `${opening}\n\n${hashtags}`;
  }

  /**
   * Get opening line based on archetype
   */
  private getOpeningLine(archetype: ArchetypeName): string {
    const options = this.OPENING_LINES[archetype];
    return this.randomChoice(options);
  }

  /**
   * Generate caption body with story highlights
   */
  private getCaptionBody(story: Story): string {
    // Extract interesting scenes for highlights
    const keyScenes = this.getKeyScenes(story);

    if (keyScenes.length === 0) {
      return story.narrative;
    }

    // Create a mini narrative from key scenes
    const highlights = keyScenes
      .map((scene) => `✨ ${scene.subtitleText}`)
      .join('\n');

    return highlights;
  }

  /**
   * Get 2-3 key scenes for caption highlights
   */
  private getKeyScenes(story: Story): Array<{ subtitleText: string }> {
    const scenes = story.scenes;

    if (scenes.length <= 3) {
      return scenes;
    }

    // Pick beginning, middle, and end
    const indices = [
      0,
      Math.floor(scenes.length / 2),
      scenes.length - 1,
    ];

    return indices.map((i) => scenes[i]);
  }

  /**
   * Get closing CTA
   */
  private getClosingCTA(): string {
    return this.randomChoice(this.CLOSING_CTAS);
  }

  /**
   * Generate hashtags based on story
   */
  public generateHashtags(story: Story, maxHashtags: number = 15): string {
    const hashtags = new Set<string>();

    // Add core hashtags
    this.CORE_HASHTAGS.forEach((tag) => hashtags.add(tag));

    // Add mood-specific hashtags
    const moodTags = this.MOOD_HASHTAGS[story.overallMood] || [];
    moodTags.forEach((tag) => hashtags.add(tag));

    // Add archetype-specific hashtags
    const archetypeTags = this.ARCHETYPE_HASHTAGS[story.archetype] || [];
    archetypeTags.forEach((tag) => hashtags.add(tag));

    // Add trending/popular tags
    const trendingTags = [
      '#fyp',
      '#foryou',
      '#viral',
      '#tiktokcat',
      '#catsoftiktok',
    ];
    trendingTags.forEach((tag) => hashtags.add(tag));

    // Convert to array and limit
    const hashtagArray = Array.from(hashtags).slice(0, maxHashtags);

    return hashtagArray.join(' ');
  }

  /**
   * Get hashtags as array (useful for API calls that want separate hashtags)
   */
  public getHashtagsArray(story: Story, maxHashtags: number = 15): string[] {
    const hashtagString = this.generateHashtags(story, maxHashtags);
    return hashtagString.split(' ');
  }

  /**
   * Generate caption with custom opening
   */
  public generateCustomCaption(
    story: Story,
    customOpening: string
  ): string {
    const parts = [
      customOpening,
      '',
      this.getCaptionBody(story),
      '',
      this.getClosingCTA(),
      '',
      this.generateHashtags(story),
    ];

    return parts.join('\n');
  }

  /**
   * Utility: Random choice from array
   */
  private randomChoice<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Validate caption length (TikTok has limits)
   */
  public validateCaption(caption: string): {
    valid: boolean;
    length: number;
    maxLength: number;
    warnings: string[];
  } {
    const maxLength = 2200; // TikTok caption limit
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
}
