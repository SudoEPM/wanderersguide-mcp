import { wgFetch, toArray } from '../client.js';

interface SearchResult {
  id?: number;
  name?: string;
  level?: number;
  [key: string]: unknown;
}

interface SearchResponse {
  ability_blocks?: SearchResult[];
  ancestries?: SearchResult[];
  archetypes?: SearchResult[];
  backgrounds?: SearchResult[];
  classes?: SearchResult[];
  creatures?: SearchResult[];
  items?: SearchResult[];
  languages?: SearchResult[];
  spells?: SearchResult[];
  traits?: SearchResult[];
  versatile_heritages?: SearchResult[];
  class_archetypes?: SearchResult[];
}

const TYPE_LABEL: Record<string, string> = {
  ability_blocks: 'feat',
  ancestries: 'ancestry',
  archetypes: 'archetype',
  backgrounds: 'background',
  classes: 'class',
  creatures: 'creature',
  items: 'item',
  languages: 'language',
  spells: 'spell',
  traits: 'trait',
  versatile_heritages: 'versatile-heritage',
  class_archetypes: 'class-archetype',
};

const TYPE_KEY: Record<string, keyof SearchResponse> = {
  spell: 'spells',
  feat: 'ability_blocks',
  item: 'items',
  creature: 'creatures',
  ancestry: 'ancestries',
  background: 'backgrounds',
  class: 'classes',
  trait: 'traits',
};

export async function searchContent(args: {
  query: string;
  type?: string;
  limit?: number;
}): Promise<string> {
  const data = await wgFetch<SearchResponse>('search-data', { text: args.query });

  const limit = args.limit ?? 10;
  const lines: string[] = [];

  const categories: [string, SearchResult[]][] = args.type && TYPE_KEY[args.type]
    ? [[TYPE_KEY[args.type], data[TYPE_KEY[args.type]] ?? []]]
    : (Object.entries(data) as [string, SearchResult[]][]).filter(([, arr]) => Array.isArray(arr) && arr.length > 0);

  for (const [key, items] of categories) {
    const label = TYPE_LABEL[key] ?? key;
    for (const r of items) {
      if (lines.length >= limit) break;
      const parts: string[] = [];
      if (r.name) parts.push(r.name);
      parts.push(`[${label}]`);
      if (r.level !== undefined) parts.push(`Level ${r.level}`);
      if (r.id !== undefined) parts.push(`(ID: ${r.id})`);
      lines.push(parts.join(' '));
    }
    if (lines.length >= limit) break;
  }

  if (lines.length === 0) {
    return `No results found for "${args.query}".`;
  }

  return `Search results for "${args.query}" (${lines.length} shown):\n${lines.join('\n')}`;
}

// ── Advanced search ───────────────────────────────────────────────────────────

interface AdvancedResult extends SearchResult {
  rank?: number;
  rarity?: string;
  actions?: string | null;
  traditions?: string[];
  type?: string;
  operations?: { type?: string; data?: { traitId?: number } }[];
}

// User-facing type → search-data `type` and result bucket
const ADVANCED_TYPES: Record<string, { apiType: string; bucket: string }> = {
  spell: { apiType: 'spell', bucket: 'spells' },
  feat: { apiType: 'ability-block', bucket: 'ability_blocks' },
  item: { apiType: 'item', bucket: 'items' },
  creature: { apiType: 'creature', bucket: 'creatures' },
  ancestry: { apiType: 'ancestry', bucket: 'ancestries' },
  background: { apiType: 'background', bucket: 'backgrounds' },
  class: { apiType: 'class', bucket: 'classes' },
  archetype: { apiType: 'archetype', bucket: 'archetypes' },
  'class-archetype': { apiType: 'class-archetype', bucket: 'class_archetypes' },
  'versatile-heritage': { apiType: 'versatile-heritage', bucket: 'versatile_heritages' },
  trait: { apiType: 'trait', bucket: 'traits' },
  language: { apiType: 'language', bucket: 'languages' },
};

const NO_LEVEL = -100;

export const ADVANCED_SEARCH_TYPES = Object.keys(ADVANCED_TYPES);

let officialSourceIds: number[] | undefined;

/** IDs of published official content sources (find-content-source's default), cached. */
export async function getOfficialSourceIds(): Promise<number[]> {
  if (!officialSourceIds) {
    const sources = await wgFetch<{ id: number }[]>('find-content-source', {});
    officialSourceIds = toArray(sources).map((s) => s.id);
  }
  return officialSourceIds;
}

/** Resolve trait names to IDs; numeric entries pass through. Throws on unknown names. */
async function resolveTraitIds(traits: (string | number)[]): Promise<number[]> {
  const ids: number[] = [];
  for (const t of traits) {
    if (typeof t === 'number' || /^\d+$/.test(t)) {
      ids.push(Number(t));
      continue;
    }
    const found = toArray(await wgFetch<{ id: number } | { id: number }[]>('find-trait', { name: t }));
    if (!found.length) throw new Error(`Unknown trait "${t}". Use find_trait to look up trait names.`);
    ids.push(found[0].id);
  }
  return ids;
}

export interface AdvancedSearchArgs {
  type: string;
  name?: string;
  description?: string;
  rarity?: string;
  traits?: (string | number)[];
  level_min?: number;
  level_max?: number;
  rank_min?: number;
  rank_max?: number;
  traditions?: string[];
  spell_type?: string;
  actions?: string;
  feat_type?: string;
  item_group?: string;
  size?: string;
  include_homebrew?: boolean;
  content_sources?: number[];
  limit?: number;
  offset?: number;
}

async function runAdvancedSearch(args: AdvancedSearchArgs): Promise<AdvancedResult[]> {
  const spec = ADVANCED_TYPES[args.type];
  if (!spec) throw new Error(`Unsupported type "${args.type}". Use one of: ${ADVANCED_SEARCH_TYPES.join(', ')}`);

  const body: Record<string, unknown> = { is_advanced: true, type: spec.apiType };
  if (args.name) body.name = args.name;
  if (args.description) body.description = args.description;
  if (args.rarity) body.rarity = args.rarity.toUpperCase();
  const traitIds = args.traits?.length ? await resolveTraitIds(args.traits) : [];
  // Creature search ignores the traits filter; creatures are filtered client-side below
  if (traitIds.length && spec.apiType !== 'creature') body.traits = traitIds;
  for (const key of ['level_min', 'level_max', 'rank_min', 'rank_max'] as const) {
    if (args[key] !== undefined) body[key] = args[key];
  }
  // The API matches traditions case-sensitively in lowercase
  if (args.traditions?.length) body.traditions = args.traditions.map((t) => t.toLowerCase());
  if (args.spell_type) body.spell_type = args.spell_type.toUpperCase();
  if (args.actions) body.actions = args.actions.toUpperCase();
  if (args.item_group) body.group = args.item_group.toUpperCase();
  if (args.size) body.size = args.size.toUpperCase();
  if (spec.apiType === 'ability-block') body.ab_type = args.feat_type ?? 'feat';

  if (args.content_sources?.length) body.content_sources = args.content_sources;
  else if (!args.include_homebrew) body.content_sources = await getOfficialSourceIds();

  const data = await wgFetch<Record<string, AdvancedResult[]>>('search-data', body);
  let rows = data?.[spec.bucket] ?? [];
  if (traitIds.length && spec.apiType === 'creature') {
    // Creature traits live in giveTrait operations rather than a traits column
    rows = rows.filter((r) => {
      const has = new Set((r.operations ?? []).filter((op) => op.type === 'giveTrait').map((op) => op.data?.traitId));
      return traitIds.every((id) => has.has(id));
    });
  }

  // Companion stat blocks (eidolons, dragonets) use level -100 as a "no level" sentinel; sort them last
  const sortKey = (r: AdvancedResult) => {
    const n = r.rank ?? r.level ?? 0;
    return n <= NO_LEVEL ? Infinity : n;
  };
  return rows.sort((a, b) => sortKey(a) - sortKey(b) || (a.name ?? '').localeCompare(b.name ?? ''));
}

function formatAdvancedResult(r: AdvancedResult): string {
  const parts: string[] = [r.name ?? '(unnamed)'];
  if (r.rank !== undefined) parts.push(r.rank === 0 ? 'Cantrip' : `Rank ${r.rank}`);
  else if (r.level !== undefined && r.level !== null) parts.push(r.level <= NO_LEVEL ? 'No fixed level' : `Level ${r.level}`);
  if (r.rarity && r.rarity !== 'COMMON') parts.push(r.rarity);
  if (r.actions) parts.push(r.actions);
  if (r.traditions?.length) parts.push(r.traditions.join('/'));
  if (r.id !== undefined) parts.push(`(ID: ${r.id})`);
  return parts.join(' · ');
}

export async function advancedSearch(args: AdvancedSearchArgs): Promise<string> {
  const rows = await runAdvancedSearch(args);
  if (rows.length === 0) return `No ${args.type} results matched those filters.`;

  const limit = args.limit ?? 25;
  const offset = args.offset ?? 0;
  const page = rows.slice(offset, offset + limit);
  if (page.length === 0) return `Offset ${offset} is past the end of the ${rows.length} results.`;

  const header = `${rows.length} ${args.type} result(s); showing ${offset + 1}–${offset + page.length}` +
    (offset + page.length < rows.length ? ` (use offset ${offset + page.length} for more)` : '') + ':';
  return [header, ...page.map(formatAdvancedResult)].join('\n');
}

/**
 * Exact-name lookups miss partial names ("Fireb"). Suggest official entries whose
 * name contains the term, for use in not-found messages.
 */
export async function suggestByName(type: string, name: string, max = 8): Promise<string> {
  try {
    const rows = await runAdvancedSearch({ type, name });
    if (!rows.length) return '';
    const names = rows.slice(0, max).map((r) => `${r.name} (ID: ${r.id})`);
    return `\nDid you mean: ${names.join(', ')}${rows.length > max ? `, … (${rows.length - max} more)` : ''}`;
  } catch {
    return '';
  }
}
