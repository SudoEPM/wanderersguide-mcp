import { wgFetch } from '../client.js';

interface Operation {
  type: string;
  data?: Record<string, unknown>;
}

interface Class {
  id?: number;
  name?: string;
  rarity?: string;
  description?: string;
  skill_training_base?: number;
  trait_id?: number;
  artwork_url?: string;
  operations?: Operation[];
  [key: string]: unknown;
}

function parseClassOps(ops: Operation[]): {
  hp?: number;
  keyAbilities: string[];
} {
  let hp: number | undefined;
  const keyAbilities: string[] = [];

  for (const op of ops) {
    const v = op.data?.variable as string | undefined;
    const val = op.data?.value;

    if (op.type === 'adjValue' && v === 'MAX_HEALTH_BONUS' && typeof val === 'number') {
      hp = (hp ?? 0) + val;
    }
    // Key ability is typically stored as giveAbilityBoost with partial:true or a specific key ability op
    if (op.type === 'setValue' && v === 'KEY_ABILITY' && typeof val === 'string') {
      keyAbilities.push(val);
    }
  }

  return { hp, keyAbilities };
}

function formatClass(c: Class): string {
  const lines: string[] = [];
  if (c.name) {
    const rare = c.rarity && c.rarity !== 'COMMON' ? ` (${c.rarity})` : '';
    lines.push(`**${c.name}**${rare}`);
  }

  const p = parseClassOps(c.operations ?? []);
  const statParts: string[] = [];
  if (p.hp !== undefined) statParts.push(`HP/level: ${p.hp}`);
  if (c.skill_training_base !== undefined) statParts.push(`Trained Skills: ${c.skill_training_base}`);
  if (statParts.length) lines.push(statParts.join(' | '));
  if (p.keyAbilities.length) lines.push(`Key Ability: ${p.keyAbilities.join(' or ')}`);

  if (c.description) lines.push(`\n${c.description}`);
  return lines.join('\n');
}

export async function findClass(args: {
  id?: number | number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = Array.isArray(args.id) ? args.id : [args.id];
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = await wgFetch<Class[]>('find-class', body);

  if (!results || results.length === 0) {
    return `No classes found matching the given criteria.`;
  }

  return results.map(formatClass).join('\n\n---\n\n');
}
