import { wgFetch } from '../client.js';

interface Ancestry {
  id?: number;
  name?: string;
  hp?: number;
  size?: string;
  speed?: number | string;
  traits?: string[];
  boosts?: string[];
  flaws?: string[];
  languages?: string[];
  description?: string;
  [key: string]: unknown;
}

function formatAncestry(a: Ancestry): string {
  const lines: string[] = [];
  if (a.name) lines.push(`**${a.name}**`);
  if (a.hp !== undefined) lines.push(`HP: ${a.hp}`);
  if (a.size) lines.push(`Size: ${a.size}`);
  if (a.speed !== undefined) lines.push(`Speed: ${a.speed} ft`);
  if (a.traits?.length) lines.push(`Traits: ${a.traits.join(', ')}`);
  if (a.boosts?.length) lines.push(`Ability Boosts: ${a.boosts.join(', ')}`);
  if (a.flaws?.length) lines.push(`Ability Flaws: ${a.flaws.join(', ')}`);
  if (a.languages?.length) lines.push(`Languages: ${a.languages.join(', ')}`);
  if (a.description) lines.push(`\n${a.description}`);
  return lines.join('\n');
}

export async function findAncestry(args: {
  name?: string;
  id?: number | number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = args.id;
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = await wgFetch<Ancestry[]>('find-ancestry', body);

  if (!results || results.length === 0) {
    const term = args.name ?? String(args.id) ?? 'given criteria';
    return `No ancestries found matching "${term}".`;
  }

  return results.map(formatAncestry).join('\n\n---\n\n');
}
