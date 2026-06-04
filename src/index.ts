import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { searchContent } from './tools/search.js';
import { findSpell } from './tools/spells.js';
import { findFeat } from './tools/feats.js';
import { findItem } from './tools/items.js';
import { findCreature } from './tools/creatures.js';
import { findAncestry } from './tools/ancestries.js';
import { findBackground } from './tools/backgrounds.js';
import { findCharacter } from './tools/characters.js';
import { findCampaign } from './tools/campaigns.js';
import { findEncounter, createEncounter } from './tools/encounters.js';

// Validate env on startup
const apiKey = process.env.WG_API_KEY;
if (!apiKey || apiKey.length !== 36) {
  console.error('ERROR: WG_API_KEY must be set to a 36-character UUID before starting.');
  process.exit(1);
}

const server = new Server(
  { name: 'wanderers-guide', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_content',
      description:
        "Full-text search across all Pathfinder 2e content (spells, feats, items, creatures, etc.). Use this as the first tool when you don't know the exact type of what you're looking for.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search term' },
          type: {
            type: 'string',
            description: "Filter by content type",
            enum: ['spell', 'feat', 'item', 'creature', 'ancestry', 'background', 'class', 'trait'],
          },
          limit: { type: 'number', description: 'Max results to return (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'find_spell',
      description:
        'Look up one or more Pathfinder 2e spells by name or ID. Returns full spell details including casting time, range, targets, duration, and description.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial or full spell name' },
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Spell ID or array of IDs',
          },
          trait: { type: 'string', description: "Filter by trait, e.g. 'fire' or 'healing'" },
        },
      },
    },
    {
      name: 'find_feat',
      description:
        'Look up feats, actions, class features, heritages, and other ability blocks. Use for rule lookups mid-session.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial or full feat name' },
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Ability block ID or array of IDs',
          },
          type: {
            type: 'string',
            description: 'Filter by type',
            enum: ['feat', 'action', 'class-feature', 'heritage', 'sense', 'physical-feature'],
          },
          traits: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by one or more traits',
          },
        },
      },
    },
    {
      name: 'find_item',
      description:
        'Look up weapons, armor, equipment, consumables, and treasure. Use for loot generation, shop inventory, or rules on a specific item.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial or full item name' },
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Item ID or array of IDs',
          },
        },
      },
    },
    {
      name: 'find_creature',
      description:
        'Look up Pathfinder 2e creatures by name, level, or trait. Use for encounter prep or when players encounter a monster.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial or full creature name' },
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Creature ID or array of IDs',
          },
          level: { type: 'number', description: 'Filter by creature level' },
        },
      },
    },
    {
      name: 'find_ancestry',
      description: 'Look up ancestries (races) including heritages and ancestry features.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial or full ancestry name' },
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Ancestry ID or array of IDs',
          },
        },
      },
    },
    {
      name: 'find_background',
      description: 'Look up character backgrounds including their skill and feat grants.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial or full background name' },
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Background ID or array of IDs',
          },
        },
      },
    },
    {
      name: 'find_character',
      description:
        "Retrieve a player character sheet from Wanderer's Guide. Requires a pre-authorized character access grant — if this returns an authorization error, the character owner must authorize access via the Wanderer's Guide account settings.",
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The character ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'find_campaign',
      description: "Retrieve campaigns you own or are a member of.",
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Specific campaign ID' },
          name: { type: 'string', description: 'Filter by campaign name' },
        },
      },
    },
    {
      name: 'find_encounter',
      description: 'Retrieve encounters within a campaign.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Specific encounter ID' },
          campaign_id: { type: 'number', description: 'Filter by campaign ID' },
        },
      },
    },
    {
      name: 'create_encounter',
      description: 'Create a new encounter in a campaign. Requires Patreon tier 1+. Use for session prep.',
      inputSchema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID to create the encounter in' },
          name: { type: 'string', description: 'Encounter name' },
          description: { type: 'string', description: 'Encounter description (optional)' },
          combatants: {
            type: 'array',
            description: 'Initial combatants (optional)',
          },
        },
        required: ['campaign_id', 'name'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let text: string;

    switch (name) {
      case 'search_content':
        text = await searchContent(args as Parameters<typeof searchContent>[0]);
        break;
      case 'find_spell':
        text = await findSpell(args as Parameters<typeof findSpell>[0]);
        break;
      case 'find_feat':
        text = await findFeat(args as Parameters<typeof findFeat>[0]);
        break;
      case 'find_item':
        text = await findItem(args as Parameters<typeof findItem>[0]);
        break;
      case 'find_creature':
        text = await findCreature(args as Parameters<typeof findCreature>[0]);
        break;
      case 'find_ancestry':
        text = await findAncestry(args as Parameters<typeof findAncestry>[0]);
        break;
      case 'find_background':
        text = await findBackground(args as Parameters<typeof findBackground>[0]);
        break;
      case 'find_character':
        text = await findCharacter(args as Parameters<typeof findCharacter>[0]);
        break;
      case 'find_campaign':
        text = await findCampaign(args as Parameters<typeof findCampaign>[0]);
        break;
      case 'find_encounter':
        text = await findEncounter(args as Parameters<typeof findEncounter>[0]);
        break;
      case 'create_encounter':
        text = await createEncounter(args as Parameters<typeof createEncounter>[0]);
        break;
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
