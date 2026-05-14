import { Brand } from './types';

/**
 * The orange-cat brand, ported verbatim from the hard-coded prompt strings
 * that existed before the brand pivot. Written to brands/orange-cat.json
 * on first server boot when the brands/ directory is empty.
 *
 * Every string here corresponds to a previously hard-coded prompt site —
 * see the brand pivot plan for the file:line origin of each field.
 */
export const ORANGE_CAT_BRAND: Brand = {
  id: 'orange-cat',
  displayName: 'Fat Orange Cat',
  version: 1,
  prompts: {
    storySystemFlavor: 'a fat orange cat',
    storyCharacter: `THE ORANGE CAT CHARACTER
- Extremely chubby orange tabby with a prominent belly.
- Big shiny, expressive eyes (often teary or sparkling for emotion).
- Bright orange and white striped fur.
- Personality: can be grumpy, sweet, dramatic, or mischievous. Very food-motivated. Adorable waddle.
- The same physical character should appear consistently in every scene.`,
    referenceSheet: `Character reference sheet for a recurring TikTok series: a chubby orange tabby cat.

Physical traits — these MUST be consistent across every appearance:
- Extremely chubby orange tabby with a prominent round belly
- Bright orange and white striped fur, soft and fluffy texture
- Big shiny expressive eyes, slightly teary or sparkling
- Endearing waddle, food-motivated personality
- Small white chest patch, white paws

Composition: full-body neutral studio shot, plain soft-grey background, even cinematic lighting, photorealistic, high detail. Vertical 9:16 framing. No text, no logos, no humans, no other animals.`,
    sceneContinuity:
      "The cat MUST match the provided reference image exactly — same chubby orange tabby, same fur pattern, same eyes, same body shape. Do not invent a new cat. Maintain perfect character continuity.",
    evalCriteria: `PASS criteria — ALL must hold:
- A chubby orange tabby cat is clearly visible
- Cat has bright orange-and-white striped fur and a prominent round belly
- Big expressive eyes
- The image roughly matches the scene's environment, mood, and described action
- No text overlays, captions, watermarks, or other animals/humans unless required

FAIL on any of: missing cat, wrong-color cat, thin/skinny cat, multiple cats, off-prompt environment, watermarks, garbled visuals.`,
  },
  archetypes: [
    {
      id: 'rags-to-riches',
      label: 'Rags to Riches',
      guidance:
        'Stray alley cat → adopted → spoiled indoor chonk (classic transformation).',
    },
    {
      id: 'from-shelter-to-home',
      label: 'From Shelter to Home',
      guidance:
        'Alone at the shelter for months → finally adopted → loved (heartwarming).',
    },
    {
      id: 'streamer-cat-glow-up',
      label: 'Streamer Cat Glow Up',
      guidance:
        'Ignored background cat → starts streaming → becomes rich and famous (comedy).',
    },
    {
      id: 'villain-arc-but-soft',
      label: 'Villain Arc But Soft',
      guidance:
        'Bullied by other cats → becomes powerful and stylish "villain" → actually just wants snacks (comedy).',
    },
    {
      id: 'chonk-to-best-friend',
      label: 'Chonk to Best Friend',
      guidance:
        'Lonely, grumpy cat → reluctantly meets new friend → becomes inseparable (friendship).',
    },
    {
      id: 'office-hero-journey',
      label: 'Office Hero Journey',
      guidance:
        'Regular office cat → accidentally saves the day → becomes workplace legend (heroic).',
    },
  ],
  caption: {
    coreHashtags: [
      '#aicat',
      '#orangecat',
      '#fatcat',
      '#chonk',
      '#catstory',
      '#aivideo',
    ],
    moodHashtags: {
      sad: ['#emotional', '#wholesome', '#rescue'],
      hopeful: ['#inspiring', '#hopeful', '#secondchance'],
      funny: ['#funnycat', '#catmemes', '#comedy'],
      dramatic: ['#dramatic', '#epic', '#cinematic'],
      heartwarming: ['#wholesome', '#heartwarming', '#love'],
      epic: ['#epic', '#legend', '#hero'],
    },
    archetypeHashtags: {
      'rags-to-riches': ['#transformation', '#glowup', '#success'],
      'from-shelter-to-home': ['#adoptdontshop', '#rescue', '#shelter'],
      'streamer-cat-glow-up': ['#gaming', '#streamer', '#gamer'],
      'villain-arc-but-soft': ['#villain', '#comedy', '#mischief'],
      'chonk-to-best-friend': ['#friendship', '#bond', '#love'],
      'office-hero-journey': ['#officecat', '#worklife', '#hero'],
    },
    archetypeOpenings: {
      'rags-to-riches': [
        'From cardboard box to internet sensation 📦→⭐',
        'This chonky boy went from zero to hero 🧡',
        'The ultimate glow-up story 😺✨',
      ],
      'from-shelter-to-home': [
        'Day 156 at the shelter... then everything changed 🏠',
        'Nobody wanted this chonk, until someone did 💛',
        'Every shelter cat deserves their moment 🐱',
      ],
      'streamer-cat-glow-up': [
        'From Zoom bomb to streaming legend 🎮',
        'When your cat becomes the real content 📹',
        'This orange chonk just hit 100k subs 🚀',
      ],
      'villain-arc-but-soft': [
        'Evil mastermind or just hungry? You decide 😈',
        'Watch this cat plot world domination (for treats) 🌍',
        'The softest villain arc ever told 🦹',
      ],
      'chonk-to-best-friend': [
        'From grumpy loner to best friends 👯',
        'When the chonk finds his person (or kitten) 💕',
        'The friendship nobody asked for but everyone needed 🐾',
      ],
      'office-hero-journey': [
        'Office cat saves the day 🦸',
        'From backpack to employee of the month 💼',
        'This chonk is now Chief Morale Officer 📊',
      ],
    },
    closingCtas: [
      'Follow for more orange cat content! 🧡',
      'Part 2? 👀',
      'Like if you love this chonk! ❤️',
      'Share with a cat lover! 🐱',
      'Tag someone who needs to see this 👇',
      'More stories coming soon! 🎬',
    ],
    trendingHashtags: ['#fyp', '#foryou', '#viral', '#tiktokcat', '#catsoftiktok'],
  },
};
