import { wgFetch } from '../client.js';

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
