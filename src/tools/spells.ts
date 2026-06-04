import { wgFetch } from '../client.js';

interface Trait {
  id: number;
  name: string;
}

interface HeightenedEntry {
  amount: string;
  text: string;
}

interface Spell {
  id?: number;
  name?: string;
  rank?: number;
  traditions?: string[];
  traits?: (string | number)[];
  cast?: string;
  range?: string;
  targets?: string;
  duration?: string;
  description?: string;
  heightened?: {
    text?: HeightenedEntry[];
    data?: unknown;
  };
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
  if (s.heightened?.text?.length) {
    const entries = s.heightened.text.map((e) => `  ${e.amount}: ${e.text}`);
    lines.push(`Heightened:\n${entries.join('\n')}`);
  }
  return lines.join('\n');
}

async function resolveTraits(spells: Spell[]): Promise<void> {
  const ids = new Set<number>();
  for (const spell of spells) {
    for (const t of spell.traits ?? []) {
      if (typeof t === 'number') ids.add(t);
    }
  }
  if (ids.size === 0) return;

  const traits = await wgFetch<Trait[]>('find-trait', { id: [...ids] });
  const byId = new Map(traits.map((t) => [t.id, t.name]));

  for (const spell of spells) {
    spell.traits = (spell.traits ?? []).map((t) =>
      typeof t === 'number' ? (byId.get(t) ?? `trait:${t}`) : t
    );
  }
}

export async function findSpell(args: {
  name?: string;
  id?: number | number[];
  traits?: number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = args.id;
  if (args.traits?.length) body.traits = args.traits;
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const raw = await wgFetch<Spell | Spell[]>('find-spell', body);
  const results: Spell[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

  if (results.length === 0) {
    const term = args.name ?? (args.id !== undefined ? String(args.id) : null) ?? 'given criteria';
    return `No spells found matching "${term}".`;
  }

  await resolveTraits(results);
  return results.map(formatSpell).join('\n\n---\n\n');
}
