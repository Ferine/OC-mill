import { z } from 'zod';
import { MoodSchema } from '../llm/schemas';

export const BrandIdSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/, 'id must be lowercase letters, digits, or hyphens');

export const BrandArchetypeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  label: z.string().min(1),
  guidance: z.string().optional(),
});

export const BrandPromptsSchema = z.object({
  storySystemFlavor: z.string().optional(),
  storyCharacter: z.string().min(1),
  referenceSheet: z.string().min(1),
  sceneContinuity: z.string().min(1),
  evalCriteria: z.string().min(1),
});

export const BrandCaptionSchema = z.object({
  coreHashtags: z.array(z.string()),
  moodHashtags: z.record(MoodSchema, z.array(z.string())).default({}),
  archetypeHashtags: z.record(z.string(), z.array(z.string())).default({}),
  archetypeOpenings: z.record(z.string(), z.array(z.string())).default({}),
  closingCtas: z.array(z.string()).min(1),
  trendingHashtags: z.array(z.string()).optional(),
});

export const BrandSchema = z.object({
  id: BrandIdSchema,
  displayName: z.string().min(1),
  version: z.literal(1),
  prompts: BrandPromptsSchema,
  archetypes: z.array(BrandArchetypeSchema).min(1),
  caption: BrandCaptionSchema,
  voicesByMood: z.record(MoodSchema, z.string()).optional(),
  musicStyleHint: z.string().optional(),
});
