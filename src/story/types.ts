export type Mood =
  | 'sad'
  | 'hopeful'
  | 'funny'
  | 'dramatic'
  | 'heartwarming'
  | 'epic';

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
