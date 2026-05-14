import { Mood } from '../story/types';

export interface BrandArchetype {
  id: string;
  label: string;
  guidance?: string;
}

export interface BrandPrompts {
  storySystemFlavor?: string;
  storyCharacter: string;
  referenceSheet: string;
  sceneContinuity: string;
  evalCriteria: string;
}

export interface BrandCaption {
  coreHashtags: string[];
  moodHashtags: Partial<Record<Mood, string[]>>;
  archetypeHashtags: Record<string, string[]>;
  archetypeOpenings: Record<string, string[]>;
  closingCtas: string[];
  trendingHashtags?: string[];
}

export interface Brand {
  id: string;
  displayName: string;
  version: 1;
  prompts: BrandPrompts;
  archetypes: BrandArchetype[];
  caption: BrandCaption;
  voicesByMood?: Partial<Record<Mood, string>>;
  musicStyleHint?: string;
}
