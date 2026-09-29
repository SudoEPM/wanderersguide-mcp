import { wgFetch } from '../client.js';

type ActionCost = 'ONE-ACTION' | 'TWO-ACTIONS' | 'THREE-ACTIONS' | 'REACTION' | 'FREE-ACTION';

const ACTION_SYMBOL: Record<string, string> = {
  'ONE-ACTION': '◆',
  'TWO-ACTIONS': '◆◆',
  'THREE-ACTIONS': '◆◆◆',
  'REACTION': '↺',
  'FREE-ACTION': '⬲',
};

interface Trait {
  id: number;
  name: string;
}

interface AbilityBlock {
  id?: number;
  name?: string;
  type?: string;
  level?: number;
  rarity?: string;
  actions?: ActionCost | null;
  traits?: (string | number)[];
  prerequisites?: string | string[];
  frequency?: string;
  cost?: string;
  trigger?: string;
  requirements?: string;
  access?: string;
  description?: string;
  special?: string;
  [key: string]: unknown;
}

function formatAbility(a: AbilityBlock): string {
  const lines: string[] = [];
  const actionStr = a.actions ? (ACTION_SYMBOL[a.actions] ?? a.actions) : null;
  const header = [
    a.name,
    actionStr,
    a.type ? `[${a.type}]` : null,
    a.level !== undefined ? `Level ${a.level}` : null,
    a.rarity && a.rarity !== 'COMMON' ? `(${a.rarity})` : null,
  ].filter(Boolean).join(' ');
  if (header) lines.push(`**${header}**`);
  if (a.traits?.length) lines.push(`Traits: ${a.traits.join(', ')}`);
  const prereqs = Array.isArray(a.prerequisites) ? a.prerequisites.join('; ') : a.prerequisites;
  if (prereqs) lines.push(`Prerequisites: ${prereqs}`);
  if (a.frequency) lines.push(`Frequency: ${a.frequency}`);
  if (a.cost) lines.push(`Cost: ${a.cost}`);
  if (a.trigger) lines.push(`Trigger: ${a.trigger}`);
  if (a.requirements) lines.push(`Requirements: ${a.requirements}`);
  if (a.access) lines.push(`Access: ${a.access}`);
  if (a.description) lines.push(`\n${a.description}`);
  if (a.special) lines.push(`\nSpecial: ${a.special}`);
  return lines.join('\n');
}

async function resolveTraits(blocks: AbilityBlock[]): Promise<void> {
  const ids = new Set<number>();
  for (const b of blocks) {
    for (const t of b.traits ?? []) {
      if (typeof t === 'number') ids.add(t);
    }
  }
  if (ids.size === 0) return;

  const traits = await wgFetch<Trait[]>('find-trait', { id: [...ids] });
  const byId = new Map(traits.map((t) => [t.id, t.name]));

  for (const b of blocks) {
    b.traits = (b.traits ?? []).map((t) =>
      typeof t === 'number' ? (byId.get(t) ?? `trait:${t}`) : t
    );
  }
}

export async function findFeat(args: {
  name?: string;
  id?: number | number[];
  type?: string;
  traits?: number[];
  prerequisites?: string[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = Array.isArray(args.id) ? args.id : [args.id];
  if (args.type) body.type = args.type;
  if (args.traits?.length) body.traits = args.traits;
  if (args.prerequisites?.length) body.prerequisites = args.prerequisites;
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = await wgFetch<AbilityBlock[]>('find-ability-block', body);

  if (!results || results.length === 0) {
    const term = args.name ?? String(args.id) ?? 'given criteria';
    return `No feats or abilities found matching "${term}".`;
  }

  await resolveTraits(results);
  return results.map(formatAbility).join('\n\n---\n\n');
}
