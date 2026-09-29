import { wgFetch, toArray } from '../client.js';
import { suggestByName } from './search.js';

interface TraitMetaData {
  important?: boolean;
  creature_trait?: boolean;
  class_trait?: boolean;
  ancestry_trait?: boolean;
  archetype_trait?: boolean;
  versatile_heritage_trait?: boolean;
  unselectable?: boolean;
}

interface Trait {
  id?: number;
  name?: string;
  description?: string;
  content_source_id?: number;
  meta_data?: TraitMetaData;
  [key: string]: unknown;
}

function formatTrait(t: Trait): string {
  const lines: string[] = [];
  if (t.name) lines.push(`**${t.name}**${t.id !== undefined ? ` (ID: ${t.id})` : ''}`);
  const categories: string[] = [];
  if (t.meta_data?.creature_trait) categories.push('creature');
  if (t.meta_data?.ancestry_trait) categories.push('ancestry');
  if (t.meta_data?.class_trait) categories.push('class');
  if (t.meta_data?.archetype_trait) categories.push('archetype');
  if (t.meta_data?.versatile_heritage_trait) categories.push('versatile heritage');
  if (categories.length) lines.push(`Categories: ${categories.join(', ')}`);
  if (t.description) lines.push(`\n${t.description}`);
  return lines.join('\n');
}

export async function findTrait(args: {
  name?: string;
  id?: number | number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  // find-trait only returns results when id is passed as an array — single integer returns nothing
  if (args.id !== undefined) body.id = Array.isArray(args.id) ? args.id : [args.id];
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = toArray(await wgFetch<Trait | Trait[]>('find-trait', body));

  if (results.length === 0) {
    const term = args.name ?? (args.id !== undefined ? String(args.id) : null) ?? 'given criteria';
    return `No traits found matching "${term}".` + (args.name ? await suggestByName('trait', args.name) : '');
  }

  return results.map(formatTrait).join('\n\n---\n\n');
}
