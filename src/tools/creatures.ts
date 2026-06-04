import { wgFetch } from '../client.js';

interface Trait {
  id: number;
  name: string;
}

export interface Operation {
  id?: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface CreatureAbility {
  id?: number;
  name?: string;
  actions?: string | null;
  trigger?: string;
  requirements?: string;
  frequency?: string;
  cost?: string;
  description?: string;
  traits?: number[];
  rarity?: string;
  level?: number;
  type?: string;
  meta_data?: Record<string, unknown>;
  content_source_id?: number;
  version?: string;
}

export interface CreatureDetails {
  description?: string;
  image_url?: string;
  background_image_url?: string;
  adjustment?: string;
  conditions?: unknown[];
}

export interface CreatureInventory {
  coins?: { cp?: number; sp?: number; gp?: number; pp?: number };
  items?: unknown[];
}

export interface CreatureSpells {
  slots?: unknown[];
  list?: unknown[];
  focus_point_current?: number;
  innate_casts?: unknown[];
}

export interface Creature {
  id?: number;
  created_at?: string;
  name?: string;
  level?: number;
  rarity?: string;
  meta_data?: Record<string, unknown> | null;
  content_source_id?: number;
  version?: string;
  uuid?: number;
  details?: CreatureDetails;
  operations?: Operation[];
  abilities_base?: CreatureAbility[];
  abilities_added?: number[];
  inventory?: CreatureInventory;
  spells?: CreatureSpells;
  deprecated?: boolean;
  [key: string]: unknown;
}

const ABILITY_SYMBOL: Record<string, string> = {
  'ONE-ACTION': '◆',
  'TWO-ACTIONS': '◆◆',
  'THREE-ACTIONS': '◆◆◆',
  'REACTION': '↺',
  'FREE-ACTION': '⬲',
};

interface ComputedStats {
  hp?: number;
  ac?: number;
  fort?: number;
  reflex?: number;
  will?: number;
  perception?: number;
  speed?: number;
  fly?: number;
  swim?: number;
  climb?: number;
  immunities: string[];
  weaknesses: string[];
  resistances: string[];
  traitIds: number[];
}

function computeStats(ops: Operation[]): ComputedStats {
  let hp = 0;
  let acBonus = 0;
  let fort = 0;
  let reflex = 0;
  let will = 0;
  let perception = 0;
  let speed: number | undefined;
  let fly: number | undefined;
  let swim: number | undefined;
  let climb: number | undefined;
  const immunities: string[] = [];
  const weaknesses: string[] = [];
  const resistances: string[] = [];
  const traitIds: number[] = [];

  for (const op of ops) {
    const v = op.data?.variable as string | undefined;
    const val = op.data?.value;

    if (op.type === 'adjValue') {
      if (v === 'MAX_HEALTH_BONUS' && typeof val === 'number') hp += val;
      if (v === 'AC_BONUS' && typeof val === 'number') acBonus += val;
      if (v === 'IMMUNITIES' && typeof val === 'string') {
        immunities.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
      }
      if (v === 'WEAKNESSES' && typeof val === 'string') {
        weaknesses.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
      }
      if (v === 'RESISTANCES' && typeof val === 'string') {
        resistances.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
      }
    } else if (op.type === 'addBonusToValue' && typeof val === 'string') {
      const n = parseInt(val, 10);
      if (!isNaN(n)) {
        if (v === 'SAVE_FORT') fort += n;
        if (v === 'SAVE_REFLEX') reflex += n;
        if (v === 'SAVE_WILL') will += n;
        if (v === 'PERCEPTION') perception += n;
      }
    } else if (op.type === 'setValue') {
      if (v === 'SPEED' && typeof val === 'number') speed = val;
      if (v === 'SPEED_FLY' && typeof val === 'number') fly = val;
      if (v === 'SPEED_SWIM' && typeof val === 'number') swim = val;
      if (v === 'SPEED_CLIMB' && typeof val === 'number') climb = val;
    } else if (op.type === 'giveTrait') {
      const traitId = (op.data as { traitId?: number })?.traitId;
      if (typeof traitId === 'number') traitIds.push(traitId);
    }
  }

  return {
    hp: hp > 0 ? hp : undefined,
    ac: acBonus > 0 ? 10 + acBonus : undefined,
    fort: fort !== 0 ? fort : undefined,
    reflex: reflex !== 0 ? reflex : undefined,
    will: will !== 0 ? will : undefined,
    perception: perception !== 0 ? perception : undefined,
    speed,
    fly,
    swim,
    climb,
    immunities,
    weaknesses,
    resistances,
    traitIds,
  };
}

function signStr(n: number): string { return n >= 0 ? `+${n}` : `${n}`; }

function formatCreature(c: Creature, traitNames: Map<number, string>): string {
  const lines: string[] = [];
  const stats = computeStats(c.operations ?? []);

  const header = [
    c.name,
    c.level !== undefined ? `Level ${c.level}` : null,
    c.rarity && c.rarity !== 'COMMON' ? `(${c.rarity})` : null,
    c.details?.adjustment ? `[${c.details.adjustment}]` : null,
  ].filter(Boolean).join(' ');
  if (header) lines.push(`**${header}**`);

  // Traits
  const traitLabels = stats.traitIds.map((id) => traitNames.get(id) ?? `trait:${id}`);
  if (traitLabels.length) lines.push(`Traits: ${traitLabels.join(', ')}`);

  // Core stats
  const coreStats: string[] = [];
  if (stats.hp !== undefined) coreStats.push(`HP ${stats.hp}`);
  if (stats.ac !== undefined) coreStats.push(`AC ${stats.ac}`);
  if (stats.perception !== undefined) coreStats.push(`Perc ${signStr(stats.perception)}`);
  if (coreStats.length) lines.push(coreStats.join(' | '));

  // Saves
  const saves: string[] = [];
  if (stats.fort !== undefined) saves.push(`Fort ${signStr(stats.fort)}`);
  if (stats.reflex !== undefined) saves.push(`Ref ${signStr(stats.reflex)}`);
  if (stats.will !== undefined) saves.push(`Will ${signStr(stats.will)}`);
  if (saves.length) lines.push(saves.join(' | '));

  // Speed
  const speeds: string[] = [];
  if (stats.speed !== undefined) speeds.push(`${stats.speed} ft`);
  if (stats.fly !== undefined) speeds.push(`fly ${stats.fly} ft`);
  if (stats.swim !== undefined) speeds.push(`swim ${stats.swim} ft`);
  if (stats.climb !== undefined) speeds.push(`climb ${stats.climb} ft`);
  if (speeds.length) lines.push(`Speed: ${speeds.join(', ')}`);

  // Immunities / weaknesses / resistances
  if (stats.immunities.length) lines.push(`Immunities: ${stats.immunities.join(', ')}`);
  if (stats.weaknesses.length) lines.push(`Weaknesses: ${stats.weaknesses.join(', ')}`);
  if (stats.resistances.length) lines.push(`Resistances: ${stats.resistances.join(', ')}`);

  // Description
  if (c.details?.description) lines.push(`\n${c.details.description}`);

  // Abilities
  const abilities = c.abilities_base ?? [];
  if (abilities.length) {
    lines.push(`\nAbilities:`);
    for (const ab of abilities) {
      if (!ab.name) continue;
      const sym = ab.actions ? (ABILITY_SYMBOL[ab.actions] ?? ab.actions) : null;
      const abHeader = [sym, ab.name].filter(Boolean).join(' ');
      const trigger = ab.trigger ? ` — Trigger: ${ab.trigger}` : '';
      lines.push(`  **${abHeader}**${trigger}`);
    }
  }

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

  const raw = await wgFetch<Creature | Creature[]>('find-creature', body);
  const results: Creature[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

  if (results.length === 0) {
    const term = args.name ?? (args.id !== undefined ? String(args.id) : null) ?? 'given criteria';
    return `No creatures found matching "${term}".`;
  }

  // Collect all trait IDs for batch resolution
  const allTraitIds = new Set<number>();
  for (const c of results) {
    for (const id of computeStats(c.operations ?? []).traitIds) {
      allTraitIds.add(id);
    }
  }
  const traitNames = new Map<number, string>();
  if (allTraitIds.size > 0) {
    const traits = await wgFetch<Trait[]>('find-trait', { id: [...allTraitIds] });
    for (const t of traits ?? []) {
      if (t.id && t.name) traitNames.set(t.id, t.name);
    }
  }

  return results.map((c) => formatCreature(c, traitNames)).join('\n\n---\n\n');
}
