import { wgFetch, toArray, filterByName } from '../client.js';

interface Operation {
  type: string;
  data?: Record<string, unknown>;
}

interface Ancestry {
  id?: number;
  name?: string;
  rarity?: string;
  description?: string;
  artwork_url?: string;
  trait_id?: number;
  content_source_id?: number;
  operations?: Operation[];
  [key: string]: unknown;
}

function parseAncestryOps(ops: Operation[]): {
  hp?: number;
  size?: string;
  speed?: number;
  visionSenses: string[];
  boosts: string[];
  flaws: string[];
  languageIds: number[];
} {
  let hp: number | undefined;
  let size: string | undefined;
  let speed: number | undefined;
  const visionSenses: string[] = [];
  const boosts: string[] = [];
  const flaws: string[] = [];
  const languageIds: number[] = [];

  for (const op of ops) {
    const v = op.data?.variable as string | undefined;
    const val = op.data?.value;

    if (op.type === 'adjValue') {
      if (v === 'MAX_HEALTH_BONUS' && typeof val === 'number') hp = (hp ?? 0) + val;
      if (v === 'SENSES_PRECISE' && typeof val === 'string') visionSenses.push(val.trim());
    } else if (op.type === 'setValue') {
      if (v === 'SPEED' && typeof val === 'number') speed = val;
      if (v === 'SIZE' && typeof val === 'string') size = val;
    } else if (op.type === 'giveAbilityBoost') {
      const attrs = (op.data as { traits?: string[]; value?: string })?.value ?? '';
      if (attrs) boosts.push(attrs);
    } else if (op.type === 'giveAbilityFlaw') {
      const attr = (op.data as { value?: string })?.value ?? '';
      if (attr) flaws.push(attr);
    } else if (op.type === 'giveLanguage') {
      const id = (op.data as { languageId?: number })?.languageId;
      if (typeof id === 'number') languageIds.push(id);
    }
  }

  return { hp, size, speed, visionSenses, boosts, flaws, languageIds };
}

function formatAncestry(a: Ancestry, langNames: Map<number, string>): string {
  const lines: string[] = [];
  if (a.name) {
    const rare = a.rarity && a.rarity !== 'COMMON' ? ` (${a.rarity})` : '';
    lines.push(`**${a.name}**${rare}`);
  }

  if (a.operations?.length) {
    const p = parseAncestryOps(a.operations);
    const statParts: string[] = [];
    if (p.hp !== undefined) statParts.push(`HP: ${p.hp}`);
    if (p.size) statParts.push(`Size: ${p.size}`);
    if (p.speed !== undefined) statParts.push(`Speed: ${p.speed} ft`);
    if (statParts.length) lines.push(statParts.join(' | '));
    if (p.visionSenses.length) lines.push(`Senses: ${p.visionSenses.join(', ')}`);
    if (p.boosts.length) lines.push(`Ability Boosts: ${p.boosts.join(', ')}`);
    if (p.flaws.length) lines.push(`Ability Flaws: ${p.flaws.join(', ')}`);
    if (p.languageIds.length) {
      const langs = p.languageIds.map((id) => langNames.get(id) ?? `lang:${id}`);
      lines.push(`Languages: ${langs.join(', ')}`);
    }
  }

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
  if (args.id !== undefined) body.id = Array.isArray(args.id) ? args.id : [args.id];
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  let results = toArray(await wgFetch<Ancestry | Ancestry[]>('find-ancestry', body));
  // find-ancestry ignores the name filter and returns every row
  if (args.name) results = filterByName(results, args.name);

  if (results.length === 0) {
    const term = args.name ?? String(args.id) ?? 'given criteria';
    return `No ancestries found matching "${term}".`;
  }

  // Collect language IDs for batch resolution
  const allLangIds = new Set<number>();
  for (const a of results) {
    for (const op of a.operations ?? []) {
      if (op.type === 'giveLanguage') {
        const id = (op.data as { languageId?: number })?.languageId;
        if (typeof id === 'number') allLangIds.add(id);
      }
    }
  }
  const langNames = new Map<number, string>();
  if (allLangIds.size > 0) {
    const langs = await wgFetch<{ id?: number; name?: string }[]>('find-language', { id: [...allLangIds] });
    for (const l of langs ?? []) {
      if (l.id && l.name) langNames.set(l.id, l.name);
    }
  }

  return results.map((a) => formatAncestry(a, langNames)).join('\n\n---\n\n');
}
