import { wgFetch } from '../client.js';

interface Class {
  id?: number;
  name?: string;
  description?: string;
  key_ability?: string[];
  hp?: number;
  traits?: string[];
  [key: string]: unknown;
}

function formatClass(c: Class): string {
  const lines: string[] = [];
  if (c.name) lines.push(`**${c.name}**${c.id !== undefined ? ` (ID: ${c.id})` : ''}`);
  if (c.key_ability?.length) lines.push(`Key Ability: ${c.key_ability.join(' or ')}`);
  if (c.hp !== undefined) lines.push(`HP per level: ${c.hp}`);
  if (c.traits?.length) lines.push(`Traits: ${c.traits.join(', ')}`);
  if (c.description) lines.push(`\n${c.description}`);
  return lines.join('\n');
}

export async function findClass(args: {
  id?: number | number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = await wgFetch<Class[]>('find-class', body);

  if (!results || results.length === 0) {
    return `No classes found matching the given criteria.`;
  }

  return results.map(formatClass).join('\n\n---\n\n');
}
