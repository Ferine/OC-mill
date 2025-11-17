/**
 * Story and scene type definitions for the orange cat agent
 */

/**
 * Mood/emotion for a scene or story
 */
export type Mood = 'sad' | 'hopeful' | 'funny' | 'dramatic' | 'heartwarming' | 'epic';

/**
 * Story archetype categories
 */
export type ArchetypeName =
  | 'RagsToRiches'
  | 'FromShelterToHome'
  | 'StreamerCatGlowUp'
  | 'VillainArcButSoft'
  | 'ChonkToBestFriend'
  | 'OfficeHeroJourney';

/**
 * A single scene in the video story
 */
export interface Scene {
  /** Brief description of what happens in this scene */
  description: string;

  /** Approximate duration in seconds */
  durationSeconds: number;

  /** Short meme-style subtitle text to overlay on video */
  subtitleText: string;

  /** Emotional mood of the scene */
  mood: Mood;

  /** Environment/setting details */
  environment: string;

  /** Cat's action in this scene */
  catAction: string;

  /** Camera movement/style (e.g., "slow zoom in", "tracking shot") */
  cameraMotion: string;
}

/**
 * Complete story structure for a fat orange cat video
 */
export interface Story {
  /** Story archetype identifier */
  archetype: ArchetypeName;

  /** Human-readable title */
  title: string;

  /** Overall narrative arc description */
  narrative: string;

  /** Target total duration in seconds */
  totalDurationSeconds: number;

  /** Ordered list of scenes that make up the story */
  scenes: Scene[];

  /** Overall mood/theme */
  overallMood: Mood;

  /** Music style recommendation */
  musicStyle: string;
}

/**
 * Archetype template for generating stories
 */
export interface ArchetypeTemplate {
  name: ArchetypeName;
  title: string;
  narrative: string;
  overallMood: Mood;
  musicStyle: string;
  sceneTemplates: Omit<Scene, 'durationSeconds'>[];
}
