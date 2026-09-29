import { wgFetch } from '../client.js';

interface Operation {
  type: string;
  data?: Record<string, unknown>;
}

interface Background {
  id?: number;
  name?: string;
  rarity?: string;
  description?: string;
  operations?: Operation[];
  [key: string]: unknown;
}

function parseBackgroundOps(ops: Operation[]): {
  boosts: string[];
  trainedSkills: string[];
  featIds: number[];
} {
  const boosts: string[] = [];
  const trainedSkills: string[] = [];
  const featIds: number[] = [];

  for (const op of ops) {
    const v = op.data?.variable as string | undefined;
    const val = op.data?.value;

    if (op.type === 'giveAbilityBoost') {
      const boost = (op.data as { value?: string })?.value ?? '';
      if (boost) boosts.push(boost);
    } else if (op.type === 'adjValue' && typeof v === 'string' && v.startsWith('SKILL_')) {
      const skillName = v.slice(6).replace(/_/g, ' ');
      if (typeof val === 'object' && val !== null && (val as { value?: string }).value === 'T') {
        trainedSkills.push(skillName.charAt(0) + skillName.slice(1).toLowerCase());
      }
    } else if (op.type === 'giveFeat') {
      const featId = (op.data as { featId?: number })?.featId;
      if (typeof featId === 'number') featIds.push(featId);
    }
  }

  return { boosts, trainedSkills, featIds };
}

function formatBackground(b: Background, featNames: Map<number, string>): string {
  const lines: string[] = [];
  if (b.name) {
    const rare = b.rarity && b.rarity !== 'COMMON' ? ` (${b.rarity})` : '';
    lines.push(`**${b.name}**${rare}`);
  }

  if (b.operations?.length) {
    const p = parseBackgroundOps(b.operations);
    if (p.boosts.length) lines.push(`Ability Boosts: ${p.boosts.join(', ')}`);
    if (p.trainedSkills.length) lines.push(`Trained Skills: ${p.trainedSkills.join(', ')}`);
    if (p.featIds.length) {
      const feats = p.featIds.map((id) => featNames.get(id) ?? `feat:${id}`);
      lines.push(`Feat Grants: ${feats.join(', ')}`);
    }
  }

  if (b.description) lines.push(`\n${b.description}`);
  return lines.join('\n');
}

export async function findBackground(args: {
  name?: string;
  id?: number | number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = Array.isArray(args.id) ? args.id : [args.id];
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = await wgFetch<Background[]>('find-background', body);

  if (!results || results.length === 0) {
    const term = args.name ?? String(args.id) ?? 'given criteria';
    return `No backgrounds found matching "${term}".`;
  }

  // Collect feat IDs for batch resolution
  const allFeatIds = new Set<number>();
  for (const b of results) {
    for (const op of b.operations ?? []) {
      if (op.type === 'giveFeat') {
        const id = (op.data as { featId?: number })?.featId;
        if (typeof id === 'number') allFeatIds.add(id);
      }
    }
  }
  const featNames = new Map<number, string>();
  if (allFeatIds.size > 0) {
    const feats = await wgFetch<{ id?: number; name?: string }[]>('find-ability-block', { id: [...allFeatIds] });
    for (const f of feats ?? []) {
      if (f.id && f.name) featNames.set(f.id, f.name);
    }
  }

  return results.map((b) => formatBackground(b, featNames)).join('\n\n---\n\n');
}
