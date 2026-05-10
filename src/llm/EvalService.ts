import OpenAI from 'openai';
import { z } from 'zod';
import { OpenRouterConfig } from '../utils/config';
import { Scene } from '../story/types';
import { logger } from '../utils/logger';

const EvalResultSchema = z.object({
  pass: z.boolean(),
  confidence: z.number().min(0).max(1),
  feedback: z.string().min(1),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;

const EVAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'confidence', 'feedback'],
  properties: {
    pass: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    feedback: { type: 'string', minLength: 1 },
  },
} as const;

const SYSTEM_PROMPT = `You are a strict QA reviewer for a TikTok video pipeline featuring a recurring fat orange cat character.

Evaluate the supplied image against the scene description.

PASS criteria — ALL must hold:
- A chubby orange tabby cat is clearly visible
- Cat has bright orange-and-white striped fur and a prominent round belly
- Big expressive eyes
- The image roughly matches the scene's environment, mood, and described action
- No text overlays, captions, watermarks, or other animals/humans unless required

FAIL on any of: missing cat, wrong-color cat, thin/skinny cat, multiple cats, off-prompt environment, watermarks, garbled visuals.

DO NOT evaluate aspect ratio, image dimensions, framing tightness, or cropping.
These are normalized in post-processing (the compositor scales+crops to
1080x1920 and the video model is given an explicit aspect_ratio). A square or
slightly off-aspect image is fine as long as the subject matter is correct.

When you fail an image, give specific, actionable feedback about the SUBJECT
or SCENE CONTENT that the image generator can fix on the next attempt
(e.g. "cat is not chubby enough — emphasize round belly", "wrong environment
— should be a rainy alley not a bedroom"). Do not give feedback about
dimensions or aspect.

Return your verdict as JSON matching the provided schema. Be honest — false passes ship bad content.`;

/**
 * VLM-driven scene QA. Used to gate per-scene keyframes before they go into
 * the (expensive) video generation step. On fail, the agent retries the
 * keyframe with the feedback fed back into the image prompt.
 */
export class EvalService {
  private client: OpenAI;
  private model: string;

  constructor(cfg: OpenRouterConfig) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': cfg.appUrl,
        'X-Title': cfg.appName,
      },
    });
    this.model = cfg.vlmModel;
  }

  public async evaluateKeyframe(opts: {
    image: Buffer;
    scene: Scene;
  }): Promise<EvalResult> {
    const dataUrl = `data:image/png;base64,${opts.image.toString('base64')}`;
    const userText = `Scene description: ${opts.scene.description}
Environment: ${opts.scene.environment}
Cat action: ${opts.scene.catAction}
Mood: ${opts.scene.mood}

Evaluate the attached image against this scene.`;

    logger.debug('Evaluating keyframe', {
      model: this.model,
      mood: opts.scene.mood,
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'EvalResult', strict: true, schema: EVAL_JSON_SCHEMA },
      },
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty eval response from VLM');
    }
    const parsed = EvalResultSchema.parse(JSON.parse(content));
    logger.info('Keyframe eval result', {
      pass: parsed.pass,
      confidence: parsed.confidence,
      feedback: parsed.feedback.slice(0, 200),
    });
    return parsed;
  }
}
