import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

interface PromptDef {
  name: string;
  description: string;
  arguments: PromptArgument[];
  build: (args: Record<string, string>) => string;
}

const PROMPTS: PromptDef[] = [
  {
    name: 'rules_lookup',
    description: 'Answer a Pathfinder 2e rules question using Wanderer\'s Guide data as the source of truth.',
    arguments: [
      { name: 'question', description: 'The rules question, e.g. "How does Grapple work?"', required: true },
    ],
    build: ({ question }) =>
      `Answer this Pathfinder 2e rules question: ${question}\n\n` +
      'Use search_content first to find relevant spells, feats, actions, items, or traits, then use the ' +
      'matching find_* tool to pull the full text. Quote the relevant rules text, cite the content ' +
      'source, and keep the final answer concise. If the data does not settle the question, say so.',
  },
  {
    name: 'build_encounter',
    description: 'Design a balanced encounter for a party and save it to a Wanderer\'s Guide campaign.',
    arguments: [
      { name: 'campaign_id', description: 'Campaign ID to save the encounter in', required: true },
      { name: 'party_level', description: 'Average party level', required: true },
      { name: 'party_size', description: 'Number of players (default 4)' },
      { name: 'difficulty', description: 'trivial, low, moderate, severe, or extreme (default moderate)' },
      { name: 'theme', description: 'Setting or theme, e.g. "undead crypt" or "forest bandits"' },
    ],
    build: ({ campaign_id, party_level, party_size = '4', difficulty = 'moderate', theme }) =>
      `Build a ${difficulty} Pathfinder 2e encounter for ${party_size} level-${party_level} characters` +
      (theme ? ` with the theme "${theme}"` : '') +
      '.\n\n' +
      'Use the PF2e encounter XP budget (trivial 40, low 60, moderate 80, severe 120, extreme 160 for 4 ' +
      'players; adjust by 10/20/20/30/40 per extra or missing player). Use find_creature to choose ' +
      'creatures that fit the theme and budget, and show the XP math. Once the creature list is final, ' +
      `call create_encounter with campaign_id ${campaign_id}, party_level ${party_level}, and ` +
      `party_size ${party_size}, and include short tactics notes in the description.`,
  },
  {
    name: 'explain_spell',
    description: 'Explain a spell in plain language, including heightening and common uses.',
    arguments: [
      { name: 'spell_name', description: 'Name of the spell', required: true },
      { name: 'rank', description: 'Rank to cast it at, if heightened' },
    ],
    build: ({ spell_name, rank }) =>
      `Look up the spell "${spell_name}" with find_spell and explain it in plain language` +
      (rank ? `, as cast at rank ${rank} (apply any heightened effects)` : '') +
      '. Cover actions, range, targets, save, duration, what it does on each degree of success, and ' +
      'one or two tactical tips.',
  },
  {
    name: 'character_summary',
    description: 'Summarize a character sheet: build, key stats, and suggestions for the next level.',
    arguments: [
      { name: 'character_id', description: 'Wanderer\'s Guide character ID', required: true },
    ],
    build: ({ character_id }) =>
      `Retrieve character ${character_id} with find_character and give a concise summary: ancestry, ` +
      'background, class, level, key attributes, defenses, notable feats and spells. Then suggest ' +
      'options for the next level, using find_feat or find_spell to confirm prerequisites.',
  },
  {
    name: 'generate_loot',
    description: 'Generate level-appropriate treasure for a party.',
    arguments: [
      { name: 'party_level', description: 'Party level', required: true },
      { name: 'theme', description: 'Where the loot is found, e.g. "dragon hoard" or "cultist shrine"' },
    ],
    build: ({ party_level, theme }) =>
      `Generate a treasure parcel for a level-${party_level} Pathfinder 2e party` +
      (theme ? ` found in a ${theme}` : '') +
      '. Follow the Treasure by Level guidance, use find_item to pick real items and confirm their ' +
      'level and price, and list each item with its level, price, and a one-line description.',
  },
];

export function registerPrompts(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map(({ name, description, arguments: args }) => ({ name, description, arguments: args })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const prompt = PROMPTS.find((p) => p.name === name);
    if (!prompt) throw new Error(`Unknown prompt: ${name}`);

    for (const arg of prompt.arguments) {
      if (arg.required && !args[arg.name]) {
        throw new Error(`Missing required argument "${arg.name}" for prompt ${name}`);
      }
    }

    return {
      description: prompt.description,
      messages: [{ role: 'user', content: { type: 'text', text: prompt.build(args) } }],
    };
  });
}
