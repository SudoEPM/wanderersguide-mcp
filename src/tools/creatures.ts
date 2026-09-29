import { wgFetch, toArray } from '../client.js';
import { suggestByName } from './search.js';
import { decompileCreature, formatStatBlock, type Creature as BuilderCreature } from './creature-builder.js';

export interface Operation {
  id?: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface CreatureAbility {
  id?: number;
  name?: string;
  actions?: string | null;
  trigger?: string;
  requirements?: string;
  frequency?: string;
  cost?: string;
  description?: string;
  traits?: number[];
  rarity?: string;
  level?: number;
  type?: string;
  meta_data?: Record<string, unknown>;
  content_source_id?: number;
  version?: string;
}

export interface CreatureDetails {
  description?: string;
  image_url?: string;
  background_image_url?: string;
  adjustment?: string;
  conditions?: unknown[];
}

export interface CreatureInventory {
  coins?: { cp?: number; sp?: number; gp?: number; pp?: number };
  items?: unknown[];
}

export interface CreatureSpells {
  slots?: unknown[];
  list?: unknown[];
  focus_point_current?: number;
  innate_casts?: unknown[];
}

export interface Creature {
  id?: number;
  created_at?: string;
  name?: string;
  level?: number;
  rarity?: string;
  meta_data?: Record<string, unknown> | null;
  content_source_id?: number;
  version?: string;
  uuid?: number;
  details?: CreatureDetails;
  operations?: Operation[];
  abilities_base?: CreatureAbility[];
  abilities_added?: number[];
  inventory?: CreatureInventory;
  spells?: CreatureSpells;
  deprecated?: boolean;
  [key: string]: unknown;
}

export async function findCreature(args: {
  name?: string;
  id?: number | number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = args.id;
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = toArray(await wgFetch<Creature | Creature[]>('find-creature', body));

  if (results.length === 0) {
    const term = args.name ?? (args.id !== undefined ? String(args.id) : null) ?? 'given criteria';
    return `No creatures found matching "${term}".` + (args.name ? await suggestByName('creature', args.name) : '');
  }

  const blocks = await Promise.all(results.map((c) => decompileCreature(c as BuilderCreature)));
  return blocks.map((b, i) => formatStatBlock(b, { id: results[i].id })).join('\n\n---\n\n');
}
