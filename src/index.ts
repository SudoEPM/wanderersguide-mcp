#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { searchContent, advancedSearch, ADVANCED_SEARCH_TYPES } from './tools/search.js';
import { findSpell } from './tools/spells.js';
import { findFeat } from './tools/feats.js';
import { findItem } from './tools/items.js';
import { findCreature } from './tools/creatures.js';
import { findAncestry } from './tools/ancestries.js';
import { findBackground } from './tools/backgrounds.js';
import { findCharacter } from './tools/characters.js';
import { findCampaign } from './tools/campaigns.js';
import { findEncounter, createEncounter, updateEncounter, deleteEncounter, encounterBudget, previewCustomCreature } from './tools/encounters.js';
import { findArchetype, findClassArchetype } from './tools/archetypes.js';
import { findClass } from './tools/classes.js';
import { findLanguage } from './tools/languages.js';
import { findTrait } from './tools/traits.js';
import { findVersatileHeritage } from './tools/versatile-heritages.js';
import { findContentSource, findContentUpdate } from './tools/content-sources.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';

// Warn (but keep running) when the key is missing, so clients can still list
// tools, prompts, and resources. Calls that hit the API will return an error.
const apiKey = process.env.WG_API_KEY;
if (!apiKey || apiKey.length !== 36) {
  console.error('WARNING: WG_API_KEY is not set to a 36-character UUID. API calls will fail until it is configured.');
}

const REF_LIST = (what: string) => ({
  type: 'array',
  items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
  description: `${what} names (or IDs)`,
});

// A normal PF2e stat block; the MCP converts it to Wanderer's Guide's creature format.
const CUSTOM_CREATURE_SCHEMA = {
  type: 'object',
  description:
    'A custom creature. Either a full stat block (name, level, perception, ac, hp, saves required), or base_creature_id/base_creature_name plus only the fields to change. ' +
    'All numbers are final totals as printed in a stat block. Stay close to GM Core "Building Creatures" values for the level; compare with find_creature results.',
  properties: {
    base_creature_id: { type: 'number', description: 'Start from this database creature and apply the other fields as overrides' },
    base_creature_name: { type: 'string', description: 'Exact name of the base creature (alternative to base_creature_id)' },
    name: { type: 'string' },
    level: { type: 'number' },
    rarity: { type: 'string', enum: ['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE'] },
    size: { type: 'string', enum: ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE', 'GARGANTUAN'] },
    traits: REF_LIST('Trait'),
    description: { type: 'string', description: 'Flavor text' },
    attributes: {
      type: 'object',
      description: 'Attribute modifiers, e.g. {"str": 4, "dex": 2, "con": 3, "int": -1, "wis": 1, "cha": 0}',
      properties: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => [a, { type: 'number' }])),
    },
    perception: { type: 'number', description: 'Perception modifier' },
    senses: { type: 'array', items: { type: 'string' }, description: 'e.g. "darkvision", "scent (imprecise) 30 feet"' },
    languages: REF_LIST('Language'),
    skills: { type: 'object', additionalProperties: { type: 'number' }, description: 'Skill modifiers, e.g. {"Stealth": 14, "Religion Lore": 12}' },
    ac: { type: 'number' },
    saves: {
      type: 'object',
      properties: { fort: { type: 'number' }, ref: { type: 'number' }, will: { type: 'number' } },
    },
    hp: { type: 'number' },
    notes: {
      type: 'object',
      description: 'Conditional notes, e.g. {"saves": ["+1 status to all saves vs. magic"], "hp": ["negative healing"]}',
      properties: Object.fromEntries(['ac', 'hp', 'saves', 'fort', 'ref', 'will', 'perception'].map((k) => [k, { type: 'array', items: { type: 'string' } }])),
    },
    immunities: { type: 'array', items: { type: 'string' }, description: 'e.g. ["poison", "paralyzed"]' },
    weaknesses: { type: 'array', items: { type: 'string' }, description: 'e.g. ["cold iron 5", "holy 10"]' },
    resistances: { type: 'array', items: { type: 'string' }, description: 'e.g. ["fire 10", "physical 5 (except silver)"]' },
    speeds: {
      type: 'object',
      properties: Object.fromEntries(['land', 'fly', 'swim', 'climb', 'burrow'].map((k) => [k, { type: 'number' }])),
    },
    strikes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['melee', 'ranged'] },
          attack: { type: 'number', description: 'Attack modifier for the first Strike, e.g. 15' },
          damage: { type: 'string', description: 'e.g. "2d8+6 slashing" or "1d10+4 piercing plus 1d6 fire"' },
          traits: REF_LIST('Weapon trait (e.g. "Agile", "Finesse", "Reach")'),
          range: { type: 'number', description: 'Range increment in feet (ranged strikes)' },
          reload: { type: 'number' },
          effects: { type: 'array', items: { type: 'string' }, description: 'On-hit effects, e.g. ["Grab"]' },
        },
        required: ['name', 'attack', 'damage'],
      },
    },
    spellcasting: {
      type: 'array',
      description: 'Spellcasting entries. Spells are looked up by exact name in the database.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['innate', 'prepared', 'spontaneous', 'focus', 'ritual'] },
          tradition: { type: 'string', enum: ['arcane', 'divine', 'occult', 'primal'] },
          dc: { type: 'number', description: 'Spell DC' },
          attack: { type: 'number', description: 'Spell attack modifier (defaults to DC - 10)' },
          spells: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                rank: { type: 'number', description: 'Rank cast at (cantrips: their heightened rank)' },
                casts_per_day: { oneOf: [{ type: 'number' }, { type: 'string', enum: ['at-will', 'constant'] }], description: 'Innate spells only' },
              },
              required: ['name', 'rank'],
            },
          },
          slots: {
            type: 'array',
            description: 'Spontaneous casters: slots per rank (default 3 per rank). Prepared slots come from the spell list.',
            items: { type: 'object', properties: { rank: { type: 'number' }, amount: { type: 'number' } } },
          },
        },
        required: ['type', 'spells'],
      },
    },
    items: {
      type: 'array',
      description: 'Existing items carried (looked up by exact name), e.g. [{"name": "Healing Potion (Minor)", "quantity": 2}]',
      items: { type: 'object', properties: { name: { type: 'string' }, id: { type: 'number' }, quantity: { type: 'number' } } },
    },
    abilities: {
      type: 'array',
      description: 'Special abilities: copy one from a database creature (from_creature), copy a database action/feat (existing: true), or write the rules text.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          existing: { type: 'boolean', description: 'Copy a database action/feat with this exact name' },
          from_creature: { oneOf: [{ type: 'string' }, { type: 'number' }], description: 'Copy the ability with this name from a database creature (exact name or ID), e.g. Reactive Strike from "Guard"' },
          actions: { type: 'string', enum: ['ONE-ACTION', 'TWO-ACTIONS', 'THREE-ACTIONS', 'REACTION', 'FREE-ACTION', 'ONE-TO-TWO-ACTIONS', 'ONE-TO-THREE-ACTIONS', 'TWO-TO-THREE-ACTIONS'] },
          traits: REF_LIST('Trait'),
          frequency: { type: 'string' },
          trigger: { type: 'string' },
          requirements: { type: 'string' },
          description: { type: 'string', description: 'Rules text, e.g. "**Effect** ..." with saves as "DC 22 Reflex"' },
        },
        required: ['name'],
      },
    },
    replace_strikes: { type: 'boolean', description: 'With a base creature: drop its strikes instead of adding to them' },
    replace_spellcasting: { type: 'boolean', description: 'With a base creature: drop its spells instead of adding to them' },
    replace_abilities: { type: 'boolean', description: 'With a base creature: drop its abilities instead of adding to them' },
    remove_abilities: { type: 'array', items: { type: 'string' }, description: 'With a base creature: ability names to remove' },
    remove_traits: { type: 'array', items: { type: 'string' }, description: 'With a base creature: trait names to remove' },
  },
} as const;

const server = new Server(
  { name: 'wanderers-guide', version: '0.2.0' },
  { capabilities: { tools: {}, prompts: {}, resources: {} } }
);

registerPrompts(server);
registerResources(server);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_content',
      description:
        "Full-text keyword search across all Pathfinder 2e content (spells, feats, items, creatures, etc.). Matches whole words, not prefixes, and returns at most 20 hits per content type. Use this when you don't know the exact type of what you're looking for; use advanced_search to filter by level, rank, traits, rarity, and other properties.",
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
      name: 'advanced_search',
      description:
        'Filter Pathfinder 2e content of one type by properties: level or rank range, traits, rarity, spell tradition, action cost, item group, size, and partial name or description text. ' +
        'Use for questions like "rank 3 arcane fire spells", "level 5 rare creatures", or "level 1 reaction feats". ' +
        'Searches official published sources only unless include_homebrew is true. Results are sorted by level/rank then name and paged with limit/offset.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ADVANCED_SEARCH_TYPES, description: 'Content type to search' },
          name: { type: 'string', description: 'Substring of the name (case-insensitive)' },
          description: { type: 'string', description: 'Text that must appear in the description' },
          rarity: { type: 'string', enum: ['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE'] },
          traits: {
            type: 'array',
            items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
            description: 'Trait names (e.g. "Fire", "Undead") or trait IDs; results must have all of them',
          },
          level_min: { type: 'number', description: 'Minimum level (feats, items, creatures)' },
          level_max: { type: 'number', description: 'Maximum level (feats, items, creatures)' },
          rank_min: { type: 'number', description: 'Minimum spell rank (0 = cantrip)' },
          rank_max: { type: 'number', description: 'Maximum spell rank' },
          traditions: {
            type: 'array',
            items: { type: 'string', enum: ['arcane', 'divine', 'occult', 'primal'] },
            description: 'Spell traditions',
          },
          spell_type: { type: 'string', enum: ['NORMAL', 'FOCUS', 'RITUAL'], description: 'Spell category' },
          actions: {
            type: 'string',
            enum: ['ONE-ACTION', 'TWO-ACTIONS', 'THREE-ACTIONS', 'REACTION', 'FREE-ACTION', 'ONE-TO-TWO-ACTIONS', 'ONE-TO-THREE-ACTIONS', 'TWO-TO-THREE-ACTIONS'],
            description: 'Action cost (feats and actions)',
          },
          feat_type: {
            type: 'string',
            enum: ['feat', 'action', 'class-feature', 'heritage', 'sense', 'physical-feature', 'mode'],
            description: 'Ability block kind when type is "feat" (default "feat")',
          },
          item_group: {
            type: 'string',
            enum: ['GENERAL', 'WEAPON', 'ARMOR', 'SHIELD', 'RUNE', 'UPGRADE', 'MATERIAL'],
            description: 'Item group',
          },
          size: { type: 'string', enum: ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE', 'GARGANTUAN'] },
          include_homebrew: { type: 'boolean', description: 'Also search homebrew and unpublished sources (default false)' },
          content_sources: { type: 'array', items: { type: 'number' }, description: 'Restrict to these content source IDs (overrides include_homebrew)' },
          limit: { type: 'number', description: 'Results per page (default 25)' },
          offset: { type: 'number', description: 'Results to skip, for paging (default 0)' },
        },
        required: ['type'],
      },
    },
    {
      name: 'find_spell',
      description:
        'Look up one or more Pathfinder 2e spells by name or ID. Returns full spell details including casting time, range, targets, duration, and description.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact spell name (case-insensitive). On a miss, similar names are suggested; use advanced_search for partial matches.' },
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
          name: { type: 'string', description: 'Exact feat name (case-insensitive). On a miss, similar names are suggested; use advanced_search for partial matches.' },
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
          name: { type: 'string', description: 'Exact item name (case-insensitive). On a miss, similar names are suggested; use advanced_search for partial matches.' },
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
          name: { type: 'string', description: 'Exact creature name (case-insensitive). On a miss, similar names are suggested; use advanced_search for partial matches.' },
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
          name: { type: 'string', description: 'Full or partial ancestry name (case-insensitive)' },
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
          name: { type: 'string', description: 'Full or partial background name (case-insensitive)' },
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
          campaign_id: { type: 'number', description: 'Filter by campaign ID to retrieve all characters in that campaign. Defaults to WG_CAMPAIGN_ID env var if not provided.' },
        },
      },
    },
    {
      name: 'find_campaign',
      description: "Retrieve campaigns by ID, owner UUID, or join key. With no filters, returns the campaigns you own.",
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
      description: 'Retrieve encounters within a campaign, with an XP/difficulty breakdown. Set detailed to include full stat blocks of every creature.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Specific encounter ID' },
          campaign_id: { type: 'number', description: 'Filter by campaign ID. Defaults to WG_CAMPAIGN_ID env var if not provided.' },
          detailed: { type: 'boolean', description: 'Include full stat blocks for each distinct creature (default false)' },
        },
      },
    },
    {
      name: 'encounter_budget',
      description:
        'Calculate encounter XP and difficulty (GM Core Building Encounters) before creating it. ' +
        'With no creatures, returns the XP budgets for the party. Creatures can be given by level, database ID, or exact name, with elite/weak adjustments.',
      inputSchema: {
        type: 'object',
        properties: {
          party_level: { type: 'number', description: 'Party level' },
          party_size: { type: 'number', description: 'Number of players (default 4)' },
          creatures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Creature ID' },
                name: { type: 'string', description: 'Exact creature name, or a label when level is given' },
                level: { type: 'number', description: 'Creature level (for custom creatures)' },
                adjustment: { type: 'string', enum: ['ELITE', 'WEAK'] },
                count: { type: 'number', description: 'How many (default 1)' },
              },
            },
          },
        },
        required: ['party_level'],
      },
    },
    {
      name: 'preview_custom_creature',
      description:
        'Build a custom creature without saving it and show the stat block Wanderer\'s Guide will compute, plus warnings (unknown spells, traits, items). ' +
        'Use it to check a custom enemy before passing the same object in create_encounter.custom_enemies.',
      inputSchema: CUSTOM_CREATURE_SCHEMA,
    },
    {
      name: 'create_encounter',
      description:
        'Create an encounter with database creatures and/or custom creatures, and report its XP and difficulty. ' +
        'Use find_creature / advanced_search for database IDs. Custom creatures are written as a normal PF2e stat block (spells, items, and traits by name) ' +
        'or as an existing creature plus overrides (base_creature_id). Use dry_run with export_file to produce an importable JSON file without saving.',
      inputSchema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: 'Campaign ID to create the encounter in. Defaults to WG_CAMPAIGN_ID env var if not provided.' },
          name: { type: 'string', description: 'Encounter name' },
          description: { type: 'string', description: 'Encounter description / GM notes (setup, tactics, XP budget)' },
          party_level: { type: 'number', description: 'Average party level (needed for the XP report)' },
          party_size: { type: 'number', description: 'Number of players in the party (default 4)' },
          enemy_creatures: {
            type: 'array',
            description: 'Enemies from the database.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Creature ID (from find_creature or advanced_search)' },
                adjustment: {
                  type: 'string',
                  enum: ['ELITE', 'WEAK'],
                  description: 'GM Core elite (+2 stats, +1 level, more HP) or weak (-2 stats, -1 level, less HP) adjustment',
                },
                count: { type: 'number', description: 'How many copies (default 1)' },
              },
              required: ['id'],
            },
          },
          custom_enemies: {
            type: 'array',
            description: 'Custom creatures. Each item uses the same shape as preview_custom_creature, plus an optional count.',
            items: { ...CUSTOM_CREATURE_SCHEMA, properties: { ...CUSTOM_CREATURE_SCHEMA.properties, count: { type: 'number', description: 'How many copies (default 1)' } } },
          },
          ally_character_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Character IDs to add as allied party members.',
          },
          export_file: { type: 'string', description: 'Also write the encounter as an importable Wanderer\'s Guide JSON file to this path' },
          dry_run: { type: 'boolean', description: 'Build and report without saving to Wanderer\'s Guide (combine with export_file)' },
        },
        required: ['name'],
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
          campaign_id: { type: 'number', description: 'Move encounter to a different campaign. Defaults to WG_CAMPAIGN_ID env var if not provided.' },
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
          name: { type: 'string', description: 'Exact language name (case-insensitive). On a miss, similar names are suggested; use advanced_search for partial matches.' },
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
          name: { type: 'string', description: 'Exact trait name (case-insensitive). On a miss, similar names are suggested; use advanced_search for partial matches.' },
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
      case 'advanced_search':
        text = await advancedSearch(args as unknown as Parameters<typeof advancedSearch>[0]);
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
      case 'encounter_budget':
        text = await encounterBudget(args as unknown as Parameters<typeof encounterBudget>[0]);
        break;
      case 'preview_custom_creature':
        text = await previewCustomCreature(args as unknown as Parameters<typeof previewCustomCreature>[0]);
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
