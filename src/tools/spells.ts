import { wgFetch } from '../client.js';

interface Spell {
  id?: number;
  name?: string;
  rank?: number;
  traditions?: string[];
  traits?: string[];
  cast?: string;
  range?: string;
  targets?: string;
  duration?: string;
  description?: string;
  heightened?: Record<string, string>;
  [key: string]: unknown;
}

function formatSpell(s: Spell): string {
  const lines: string[] = [];
  if (s.name) lines.push(`**${s.name}**${s.rank !== undefined ? ` (Rank ${s.rank})` : ''}`);
  if (s.traditions?.length) lines.push(`Traditions: ${s.traditions.join(', ')}`);
  if (s.traits?.length) lines.push(`Traits: ${s.traits.join(', ')}`);
  if (s.cast) lines.push(`Cast: ${s.cast}`);
  if (s.range) lines.push(`Range: ${s.range}`);
  if (s.targets) lines.push(`Targets: ${s.targets}`);
  if (s.duration) lines.push(`Duration: ${s.duration}`);
  if (s.description) lines.push(`\n${s.description}`);
  if (s.heightened) {
    const entries = Object.entries(s.heightened).map(([k, v]) => `  ${k}: ${v}`);
    lines.push(`Heightened:\n${entries.join('\n')}`);
  }
  return lines.join('\n');
}

export async function findSpell(args: {
  name?: string;
  id?: number | number[];
  trait?: string;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = args.id;
  if (args.trait) body.trait = args.trait;

  const results = await wgFetch<Spell[]>('find-spell', body);

  if (!results || results.length === 0) {
    const term = args.name ?? String(args.id) ?? args.trait ?? 'given criteria';
    return `No spells found matching "${term}".`;
  }

  return results.map(formatSpell).join('\n\n---\n\n');
}
