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
import { findEncounter, createEncounter, updateEncounter, deleteEncounter } from './tools/encounters.js';
import { findArchetype, findClassArchetype } from './tools/archetypes.js';
import { findClass } from './tools/classes.js';
import { findLanguage } from './tools/languages.js';
import { findTrait } from './tools/traits.js';
import { findVersatileHeritage } from './tools/versatile-heritages.js';
import { findContentSource, findContentUpdate } from './tools/content-sources.js';

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
          traits: {
            type: 'array',
            items: { type: 'number' },
            description: 'Filter by trait IDs (use find_feat or search_content to look up trait IDs)',
          },
          content_sources: {
            type: 'array',
            items: { type: 'number' },
            description: 'Limit results to specific content source IDs',
          },
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
            enum: ['feat', 'action', 'class-feature', 'heritage', 'sense', 'physical-feature', 'mode'],
          },
          traits: {
            type: 'array',
            items: { type: 'number' },
            description: 'Filter by trait IDs',
          },
          prerequisites: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by prerequisite strings',
          },
          content_sources: {
            type: 'array',
            items: { type: 'number' },
            description: 'Limit results to specific content source IDs',
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
          content_sources: {
            type: 'array',
            items: { type: 'number' },
            description: 'Limit results to specific content source IDs',
          },
        },
      },
    },
    {
      name: 'find_creature',
      description:
        'Look up Pathfinder 2e creatures by name or ID. Use for encounter prep or when players encounter a monster.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial or full creature name' },
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Creature ID or array of IDs',
          },
          content_sources: {
            type: 'array',
            items: { type: 'number' },
            description: 'Limit results to specific content source IDs',
          },
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
          content_sources: {
            type: 'array',
            items: { type: 'number' },
            description: 'Limit results to specific content source IDs',
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
          content_sources: {
            type: 'array',
            items: { type: 'number' },
            description: 'Limit results to specific content source IDs',
          },
        },
      },
    },
    {
      name: 'find_character',
      description:
        "Retrieve one or more player character sheets from Wanderer's Guide. Requires a pre-authorized character access grant — if this returns an authorization error, the character owner must authorize access via the Wanderer's Guide account settings.",
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Character ID or array of IDs',
          },
          user_id: { type: 'string', description: 'Filter by user UUID to retrieve all characters belonging to that user' },
          campaign_id: { type: 'number', description: 'Filter by campaign ID to retrieve all characters in that campaign' },
        },
      },
    },
    {
      name: 'find_campaign',
      description: "Retrieve campaigns you own or are a member of.",
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Campaign ID or array of IDs',
          },
          user_id: { type: 'string', description: 'Filter by user UUID to retrieve campaigns owned by that user' },
          join_key: { type: 'string', description: 'Look up a campaign by its join key' },
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
      description: 'Create a new encounter in a campaign with combatants and party info. Use find_creature to look up creature IDs first. Pass duplicate IDs to add multiple copies of the same creature (e.g. two harpies = [harpyId, harpyId]).',
      inputSchema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID to create the encounter in' },
          name: { type: 'string', description: 'Encounter name' },
          description: { type: 'string', description: 'Encounter description / GM notes' },
          party_level: { type: 'number', description: 'Average party level for XP budget display' },
          party_size: { type: 'number', description: 'Number of players in the party' },
          enemy_creatures: {
            type: 'array',
            description: 'Enemies to add. Repeat an entry for multiple copies of the same creature.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Creature ID (from find_creature)' },
                adjustment: {
                  type: 'string',
                  enum: ['ELITE', 'WEAK'],
                  description: 'Apply elite (+2 to stats) or weak (-2 to stats) adjustment',
                },
              },
              required: ['id'],
            },
          },
          ally_character_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Character IDs to add as allied party members.',
          },
        },
        required: ['campaign_id', 'name'],
      },
    },
    {
      name: 'update_encounter',
      description: 'Update metadata on an existing encounter (name, description, party info, icon, color). Does not modify combatants.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Encounter ID to update' },
          name: { type: 'string', description: 'New encounter name' },
          description: { type: 'string', description: 'New encounter description' },
          party_level: { type: 'number', description: 'Party level for XP budget display' },
          party_size: { type: 'number', description: 'Number of players' },
          campaign_id: { type: 'number', description: 'Move encounter to a different campaign' },
          icon: { type: 'string', description: 'Encounter icon name' },
          color: { type: 'string', description: 'Encounter color hex code' },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_encounter',
      description: 'Permanently delete an encounter by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Encounter ID to delete' },
        },
        required: ['id'],
      },
    },
    {
      name: 'find_archetype',
      description: 'Look up archetypes by ID, content source, or dedication feat ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Archetype ID or array of IDs',
          },
          content_sources: { type: 'array', items: { type: 'number' }, description: 'Limit to specific content source IDs' },
          dedication_feat_id: { type: 'number', description: 'Filter by dedication feat ID' },
        },
      },
    },
    {
      name: 'find_class_archetype',
      description: 'Look up class-specific archetypes (e.g. Magus Hybrid Study) by ID, class, or content source.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Class archetype ID or array of IDs',
          },
          content_sources: { type: 'array', items: { type: 'number' }, description: 'Limit to specific content source IDs' },
          class_id: { type: 'number', description: 'Filter by class ID' },
        },
      },
    },
    {
      name: 'find_class',
      description: 'Look up Pathfinder 2e classes (Barbarian, Wizard, etc.) by ID or content source.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Class ID or array of IDs',
          },
          content_sources: { type: 'array', items: { type: 'number' }, description: 'Limit to specific content source IDs' },
        },
      },
    },
    {
      name: 'find_language',
      description: 'Look up languages (Common, Elven, etc.) by name, ID, or content source.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial or full language name' },
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Language ID or array of IDs',
          },
          content_sources: { type: 'array', items: { type: 'number' }, description: 'Limit to specific content source IDs' },
        },
      },
    },
    {
      name: 'find_trait',
      description: 'Look up traits (Fire, Magical, etc.) by name or ID. Useful to resolve a trait name to its ID for use in other filters.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial or full trait name' },
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Trait ID or array of IDs',
          },
          content_sources: { type: 'array', items: { type: 'number' }, description: 'Limit to specific content source IDs' },
        },
      },
    },
    {
      name: 'find_versatile_heritage',
      description: 'Look up versatile heritages (Dhampir, Beastkin, etc.) by ID, content source, or parent heritage.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Versatile heritage ID or array of IDs',
          },
          content_sources: { type: 'array', items: { type: 'number' }, description: 'Limit to specific content source IDs' },
          heritage_id: { type: 'number', description: 'Filter by parent heritage ID' },
        },
      },
    },
    {
      name: 'find_content_source',
      description: 'Look up content sources (books, homebrew packs) by ID, group, or flags.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }],
            description: 'Content source ID or array of IDs',
          },
          foundry_id: { type: 'string', description: 'Foundry VTT module ID' },
          group: { type: 'string', description: 'Content group name' },
          homebrew: { type: 'boolean', description: 'Filter to homebrew sources only' },
          published: { type: 'boolean', description: 'Filter to published sources only' },
        },
      },
    },
    {
      name: 'find_content_update',
      description: 'Look up community-submitted content updates (errata) by state, user, or date range.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Content update ID' },
          user_id: { type: 'string', description: 'Filter by submitter UUID' },
          state: {
            type: 'string',
            enum: ['PENDING', 'APPROVED', 'REJECTED'],
            description: 'Filter by review state',
          },
          created: {
            type: 'object',
            description: 'Filter by creation date range',
            properties: {
              from: { type: 'string', description: 'ISO 8601 start date' },
              to: { type: 'string', description: 'ISO 8601 end date' },
            },
          },
        },
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
      case 'update_encounter':
        text = await updateEncounter(args as Parameters<typeof updateEncounter>[0]);
        break;
      case 'delete_encounter':
        text = await deleteEncounter(args as Parameters<typeof deleteEncounter>[0]);
        break;
      case 'find_archetype':
        text = await findArchetype(args as Parameters<typeof findArchetype>[0]);
        break;
      case 'find_class_archetype':
        text = await findClassArchetype(args as Parameters<typeof findClassArchetype>[0]);
        break;
      case 'find_class':
        text = await findClass(args as Parameters<typeof findClass>[0]);
        break;
      case 'find_language':
        text = await findLanguage(args as Parameters<typeof findLanguage>[0]);
        break;
      case 'find_trait':
        text = await findTrait(args as Parameters<typeof findTrait>[0]);
        break;
      case 'find_versatile_heritage':
        text = await findVersatileHeritage(args as Parameters<typeof findVersatileHeritage>[0]);
        break;
      case 'find_content_source':
        text = await findContentSource(args as Parameters<typeof findContentSource>[0]);
        break;
      case 'find_content_update':
        text = await findContentUpdate(args as Parameters<typeof findContentUpdate>[0]);
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
