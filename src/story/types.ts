/**
 * Story and scene type definitions for the orange cat agent.
 */

export type Mood =
  | 'sad'
  | 'hopeful'
  | 'funny'
  | 'dramatic'
  | 'heartwarming'
  | 'epic';

export type ArchetypeName =
  | 'RagsToRiches'
  | 'FromShelterToHome'
  | 'StreamerCatGlowUp'
  | 'VillainArcButSoft'
  | 'ChonkToBestFriend'
  | 'OfficeHeroJourney';

export interface Scene {
  description: string;
  durationSeconds: number;
  subtitleText: string;
  mood: Mood;
  environment: string;
  catAction: string;
  cameraMotion: string;
}

export interface Story {
  archetype: ArchetypeName;
  title: string;
  narrative: string;
  totalDurationSeconds: number;
  scenes: Scene[];
  overallMood: Mood;
  musicStyle: string;
}
