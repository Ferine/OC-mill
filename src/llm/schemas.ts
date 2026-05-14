import { z } from 'zod';

export const moodNames = [
  'sad',
  'hopeful',
  'funny',
  'dramatic',
  'heartwarming',
  'epic',
] as const;

export const MoodSchema = z.enum(moodNames);

export const SceneSchema = z.object({
  description: z.string().min(1),
  durationSeconds: z.number().int().positive(),
  subtitleText: z.string().min(1),
  mood: MoodSchema,
  environment: z.string().min(1),
  catAction: z.string().min(1),
  cameraMotion: z.string().min(1),
});

export const StorySchema = z.object({
  brandId: z.string().min(1),
  archetypeId: z.string().min(1),
  title: z.string().min(1),
  narrative: z.string().min(1),
  totalDurationSeconds: z.number().int().positive(),
  scenes: z.array(SceneSchema).min(6).max(10),
  overallMood: MoodSchema,
  musicStyle: z.string().min(1),
});

export type StoryZ = z.infer<typeof StorySchema>;

/**
 * Hand-written JSON Schema mirroring StorySchema for OpenRouter / OpenAI
 * structured-outputs `response_format`. Archetype is a free-form string
 * here (validated against the active brand's list after parse) because the
 * valid set is dynamic per-brand and can't be expressed as a JSON-schema
 * enum at request time.
 *
 * The LLM does NOT see `brandId` — the server fills that in after parsing,
 * since the brand is a deployment-time choice, not the model's call. This
 * keeps the structured-output contract narrow and avoids the LLM
 * hallucinating a different brandId than the one the run was started with.
 */
export const STORY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'archetypeId',
    'title',
    'narrative',
    'totalDurationSeconds',
    'scenes',
    'overallMood',
    'musicStyle',
  ],
  properties: {
    archetypeId: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    narrative: { type: 'string', minLength: 1 },
    totalDurationSeconds: { type: 'integer', minimum: 1 },
    overallMood: { type: 'string', enum: [...moodNames] },
    musicStyle: { type: 'string', minLength: 1 },
    scenes: {
      type: 'array',
      minItems: 6,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'description',
          'durationSeconds',
          'subtitleText',
          'mood',
          'environment',
          'catAction',
          'cameraMotion',
        ],
        properties: {
          description: { type: 'string', minLength: 1 },
          durationSeconds: { type: 'integer', minimum: 1 },
          subtitleText: { type: 'string', minLength: 1 },
          mood: { type: 'string', enum: [...moodNames] },
          environment: { type: 'string', minLength: 1 },
          catAction: { type: 'string', minLength: 1 },
          cameraMotion: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;
