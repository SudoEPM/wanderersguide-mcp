import { wgFetch } from '../client.js';

interface Archetype {
  id?: number;
  name?: string;
  rarity?: string;
  description?: string;
  trait_id?: number;
  artwork_url?: string;
  dedication_feat_id?: number;
  content_source_id?: number;
  [key: string]: unknown;
}

interface ClassArchetype {
  id?: number;
  name?: string;
  rarity?: string;
  description?: string;
  class_id?: number;
  archetype_id?: number;
  deprecated?: boolean;
  [key: string]: unknown;
}

function formatArchetype(a: Archetype): string {
  const lines: string[] = [];
  const rare = a.rarity && a.rarity !== 'COMMON' ? ` (${a.rarity})` : '';
  if (a.name) lines.push(`**${a.name}**${rare}${a.id !== undefined ? ` (ID: ${a.id})` : ''}`);
  if (a.description) lines.push(`\n${a.description}`);
  return lines.join('\n');
}

function formatClassArchetype(a: ClassArchetype): string {
  const lines: string[] = [];
  const rare = a.rarity && a.rarity !== 'COMMON' ? ` (${a.rarity})` : '';
  if (a.name) lines.push(`**${a.name}**${rare}${a.id !== undefined ? ` (ID: ${a.id})` : ''}`);
  if (a.class_id !== undefined) lines.push(`Class ID: ${a.class_id}`);
  if (a.description) lines.push(`\n${a.description}`);
  return lines.join('\n');
}

export async function findArchetype(args: {
  id?: number | number[];
  content_sources?: number[];
  dedication_feat_id?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.content_sources?.length) body.content_sources = args.content_sources;
  if (args.dedication_feat_id !== undefined) body.dedication_feat_id = args.dedication_feat_id;

  const results = await wgFetch<Archetype[]>('find-archetype', body);

  if (!results || results.length === 0) {
    return `No archetypes found matching the given criteria.`;
  }

  return results.map(formatArchetype).join('\n\n---\n\n');
}

export async function findClassArchetype(args: {
  id?: number | number[];
  content_sources?: number[];
  class_id?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.content_sources?.length) body.content_sources = args.content_sources;
  if (args.class_id !== undefined) body.class_id = args.class_id;

  const results = await wgFetch<ClassArchetype[]>('find-class-archetype', body);

  if (!results || results.length === 0) {
    return `No class archetypes found matching the given criteria.`;
  }

  return results.map(formatClassArchetype).join('\n\n---\n\n');
}
