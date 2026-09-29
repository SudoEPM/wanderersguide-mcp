import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { findSpell } from './tools/spells.js';
import { findFeat } from './tools/feats.js';
import { findItem } from './tools/items.js';
import { findCreature } from './tools/creatures.js';
import { findAncestry } from './tools/ancestries.js';
import { findBackground } from './tools/backgrounds.js';
import { findClass } from './tools/classes.js';
import { findArchetype } from './tools/archetypes.js';
import { findTrait } from './tools/traits.js';
import { findLanguage } from './tools/languages.js';
import { findCharacter } from './tools/characters.js';
import { findCampaign } from './tools/campaigns.js';
import { findEncounter } from './tools/encounters.js';
import { findContentSource } from './tools/content-sources.js';

interface ResourceType {
  type: string;
  label: string;
  fetch: (id: number) => Promise<string>;
}

// Each entry is exposed as the URI template wg://<type>/{id}
const RESOURCE_TYPES: ResourceType[] = [
  { type: 'spell', label: 'Spell', fetch: (id) => findSpell({ id }) },
  { type: 'feat', label: 'Feat / ability block', fetch: (id) => findFeat({ id }) },
  { type: 'item', label: 'Item', fetch: (id) => findItem({ id }) },
  { type: 'creature', label: 'Creature', fetch: (id) => findCreature({ id }) },
  { type: 'ancestry', label: 'Ancestry', fetch: (id) => findAncestry({ id }) },
  { type: 'background', label: 'Background', fetch: (id) => findBackground({ id }) },
  { type: 'class', label: 'Class', fetch: (id) => findClass({ id }) },
  { type: 'archetype', label: 'Archetype', fetch: (id) => findArchetype({ id }) },
  { type: 'trait', label: 'Trait', fetch: (id) => findTrait({ id }) },
  { type: 'language', label: 'Language', fetch: (id) => findLanguage({ id }) },
  { type: 'character', label: 'Character sheet', fetch: (id) => findCharacter({ id }) },
  { type: 'campaign', label: 'Campaign', fetch: (id) => findCampaign({ id }) },
  { type: 'encounter', label: 'Encounter', fetch: (id) => findEncounter({ id }) },
];

const CONTENT_SOURCES_URI = 'wg://content-sources';

export function registerResources(server: Server): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: CONTENT_SOURCES_URI,
        name: 'Published content sources',
        description: 'All published Pathfinder 2e books and packs, with their IDs for use in content_sources filters.',
        mimeType: 'text/markdown',
      },
    ],
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: RESOURCE_TYPES.map(({ type, label }) => ({
      uriTemplate: `wg://${type}/{id}`,
      name: label,
      description: `A Wanderer's Guide ${label.toLowerCase()} by numeric ID.`,
      mimeType: 'text/markdown',
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    let text: string;
    if (uri === CONTENT_SOURCES_URI) {
      text = await findContentSource({ published: true });
    } else {
      const match = /^wg:\/\/([a-z-]+)\/(\d+)$/.exec(uri);
      const resourceType = match && RESOURCE_TYPES.find((r) => r.type === match[1]);
      if (!match || !resourceType) throw new Error(`Unknown resource URI: ${uri}`);
      text = await resourceType.fetch(Number(match[2]));
    }

    return { contents: [{ uri, mimeType: 'text/markdown', text }] };
  });
}
