import { wgFetch } from '../client.js';

interface VersatileHeritage {
  id?: number;
  name?: string;
  rarity?: string;
  description?: string;
  heritage_id?: number;
  trait_id?: number;
  artwork_url?: string;
  content_source_id?: number;
  [key: string]: unknown;
}

function formatVersatileHeritage(v: VersatileHeritage): string {
  const lines: string[] = [];
  const rare = v.rarity && v.rarity !== 'COMMON' ? ` (${v.rarity})` : '';
  if (v.name) lines.push(`**${v.name}**${rare}${v.id !== undefined ? ` (ID: ${v.id})` : ''}`);
  if (v.description) lines.push(`\n${v.description}`);
  return lines.join('\n');
}

export async function findVersatileHeritage(args: {
  id?: number | number[];
  content_sources?: number[];
  heritage_id?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = Array.isArray(args.id) ? args.id : [args.id];
  if (args.content_sources?.length) body.content_sources = args.content_sources;
  if (args.heritage_id !== undefined) body.heritage_id = args.heritage_id;

  const results = await wgFetch<VersatileHeritage[]>('find-versatile-heritage', body);

  if (!results || results.length === 0) {
    return `No versatile heritages found matching the given criteria.`;
  }

  return results.map(formatVersatileHeritage).join('\n\n---\n\n');
}
