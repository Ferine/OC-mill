export type Mood =
  | 'sad'
  | 'hopeful'
  | 'funny'
  | 'dramatic'
  | 'heartwarming'
  | 'epic';

export const MOODS: readonly Mood[] = [
  'sad',
  'hopeful',
  'funny',
  'dramatic',
  'heartwarming',
  'epic',
] as const;

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
  brandId: string;
  archetypeId: string;
  title: string;
  narrative: string;
  totalDurationSeconds: number;
  scenes: Scene[];
  overallMood: Mood;
  musicStyle: string;
}

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

export interface RunSummary {
  runId: string;
  runDir: string;
  status: 'running' | 'success' | 'failed' | 'idle';
  storyTitle?: string;
  archetype?: string;
  sceneCount?: number;
  hasFinal: boolean;
  startedAtMs?: number;
}

export interface SceneFileStatus {
  sceneIndex: number;
  keyframe: { exists: boolean; bytes?: number; evalPassed?: boolean };
  clip: { exists: boolean; bytes?: number };
  narration: { exists: boolean; bytes?: number };
}

export interface RunDetail extends RunSummary {
  story?: Story;
  scenes: SceneFileStatus[];
  active: boolean;
}

export interface PipelineEvent {
  type: string;
  [key: string]: unknown;
}
