import { wgFetch } from '../client.js';

interface Creature {
  id?: number;
  name?: string;
  level?: number;
  traits?: string[];
  alignment?: string;
  size?: string;
  hp?: number;
  ac?: number;
  perception?: number;
  speed?: string | number;
  description?: string;
  [key: string]: unknown;
}

function formatCreature(c: Creature): string {
  const lines: string[] = [];
  const header = [c.name, c.level !== undefined ? `Level ${c.level}` : null].filter(Boolean).join(' — ');
  if (header) lines.push(`**${header}**`);
  const tags = [c.alignment, c.size, ...(c.traits ?? [])].filter(Boolean);
  if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
  const stats: string[] = [];
  if (c.hp !== undefined) stats.push(`HP ${c.hp}`);
  if (c.ac !== undefined) stats.push(`AC ${c.ac}`);
  if (c.perception !== undefined) stats.push(`Perception +${c.perception}`);
  if (stats.length) lines.push(stats.join(' | '));
  if (c.speed !== undefined) lines.push(`Speed: ${c.speed}`);
  if (c.description) lines.push(`\n${c.description}`);
  return lines.join('\n');
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

  const results = await wgFetch<Creature[]>('find-creature', body);

  if (!results || results.length === 0) {
    const term = args.name ?? (args.id !== undefined ? String(args.id) : null) ?? 'given criteria';
    return `No creatures found matching "${term}".`;
  }

  return results.map(formatCreature).join('\n\n---\n\n');
}
