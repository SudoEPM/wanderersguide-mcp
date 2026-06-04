import { wgFetch } from '../client.js';

interface VersatileHeritage {
  id?: number;
  name?: string;
  description?: string;
  heritage_id?: number;
  traits?: string[];
  [key: string]: unknown;
}

function formatVersatileHeritage(v: VersatileHeritage): string {
  const lines: string[] = [];
  if (v.name) lines.push(`**${v.name}**${v.id !== undefined ? ` (ID: ${v.id})` : ''}`);
  if (v.traits?.length) lines.push(`Traits: ${v.traits.join(', ')}`);
  if (v.description) lines.push(`\n${v.description}`);
  return lines.join('\n');
}

export async function findVersatileHeritage(args: {
  id?: number | number[];
  content_sources?: number[];
  heritage_id?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.content_sources?.length) body.content_sources = args.content_sources;
  if (args.heritage_id !== undefined) body.heritage_id = args.heritage_id;

  const results = await wgFetch<VersatileHeritage[]>('find-versatile-heritage', body);

  if (!results || results.length === 0) {
    return `No versatile heritages found matching the given criteria.`;
  }

  return results.map(formatVersatileHeritage).join('\n\n---\n\n');
}
