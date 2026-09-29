import { randomUUID } from 'node:crypto';
import { wgFetch, toArray } from '../client.js';
import { getOfficialSourceIds } from './search.js';
import {
  ATTRIBUTES,
  SKILL_ATTRIBUTE,
  NO_LEVEL,
  computeStrike,
  computeTotals,
  conditionalNotes,
  signed,
  strikeAttributes,
  spellProficiency,
  type Attribute,
  type Attributes,
  type Operation,
  type StrikeItemMeta,
} from '../creature-engine.js';

/**
 * A human-readable creature stat block, and conversion to/from the Wanderer's Guide creature
 * format (the same JSON an exported encounter embeds). Mirrors WG's own Foundry importer
 * (frontend/src/process/upload/creature-import.ts): stats are written as the difference between
 * the target value and what the engine derives from level and attributes.
 */

// ── Stat block types ──────────────────────────────────────────────────────────

/** A content reference: a name to look up, a numeric ID, or both. */
export type Ref = string | number | { id: number; name?: string };

export type ActionCost =
  | 'ONE-ACTION'
  | 'TWO-ACTIONS'
  | 'THREE-ACTIONS'
  | 'REACTION'
  | 'FREE-ACTION'
  | 'ONE-TO-TWO-ACTIONS'
  | 'ONE-TO-THREE-ACTIONS'
  | 'TWO-TO-THREE-ACTIONS'
  | null;

export interface Strike {
  name: string;
  type?: 'melee' | 'ranged';
  attack: number;
  /** e.g. "2d6+4 slashing", "1d8 piercing plus 1d6 fire" */
  damage: string;
  traits?: Ref[];
  range?: number;
  reload?: number;
  /** Extra effects on a hit, e.g. ["Grab"] or ["Putrid Plague"] */
  effects?: string[];
  _item?: Record<string, unknown>;
}

export interface SpellRef {
  name?: string;
  id?: number;
  rank: number;
  casts_per_day?: number | 'at-will' | 'constant';
  cantrip?: boolean;
}

export interface Spellcasting {
  type: 'innate' | 'prepared' | 'spontaneous' | 'focus' | 'ritual';
  tradition?: 'arcane' | 'divine' | 'occult' | 'primal';
  dc?: number;
  attack?: number;
  spells: SpellRef[];
  /** Spontaneous casters: slots per rank. Prepared slots are derived from the spell list. */
  slots?: { rank: number; amount: number }[];
  focus_points?: number;
}

export interface AbilityInput {
  name: string;
  actions?: ActionCost;
  traits?: Ref[];
  trigger?: string;
  requirements?: string;
  frequency?: string;
  description?: string;
  /** Copy an existing ability block (feat/action) by name instead of writing the text. */
  existing?: boolean;
  /** Copy the ability with this name from a database creature (ID or exact name), e.g. a Guard's Reactive Strike. */
  from_creature?: string | number;
  _raw?: Record<string, unknown>;
}

export interface ItemRef {
  name?: string;
  id?: number;
  quantity?: number;
  _raw?: Record<string, unknown>;
}

export interface StatBlock {
  name: string;
  level: number;
  rarity?: 'COMMON' | 'UNCOMMON' | 'RARE' | 'UNIQUE';
  size?: 'TINY' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'HUGE' | 'GARGANTUAN';
  traits?: Ref[];
  description?: string;
  image_url?: string;
  /** Attribute modifiers, e.g. { str: 4, dex: 2 } */
  attributes?: Partial<Record<Lowercase<Attribute>, number>>;
  perception: number;
  /** e.g. "darkvision", "scent (imprecise) 30 feet" */
  senses?: string[];
  languages?: Ref[];
  /** Skill totals, e.g. { "Stealth": 12, "Underworld Lore": 10 } */
  skills?: Record<string, number>;
  ac: number;
  saves: { fort: number; ref: number; will: number };
  hp: number;
  /** Conditional notes, e.g. { saves: ["+1 status to all saves vs. magic"] } */
  notes?: Partial<Record<'ac' | 'hp' | 'saves' | 'fort' | 'ref' | 'will' | 'perception', string[]>>;
  /** e.g. ["poison", "paralyzed"] */
  immunities?: string[];
  /** e.g. ["cold iron 5", "fire, 10"] */
  weaknesses?: string[];
  resistances?: string[];
  speeds?: { land?: number; fly?: number; swim?: number; climb?: number; burrow?: number };
  strikes?: Strike[];
  spellcasting?: Spellcasting[];
  items?: ItemRef[];
  abilities?: AbilityInput[];
  /** Operations the stat block doesn't model, preserved when rebuilding an existing creature. */
  _extra_ops?: Operation[];
  _base?: Record<string, unknown>;
}

/** A stat block derived from an existing creature, with overrides. */
export interface BasedStatBlock extends Partial<Omit<StatBlock, 'saves' | 'attributes' | 'speeds'>> {
  base_creature_id?: number;
  base_creature_name?: string;
  saves?: Partial<StatBlock['saves']>;
  attributes?: StatBlock['attributes'];
  speeds?: StatBlock['speeds'];
  replace_strikes?: boolean;
  replace_spellcasting?: boolean;
  replace_abilities?: boolean;
  remove_abilities?: string[];
  remove_traits?: string[];
}

export type Creature = Record<string, unknown> & {
  id?: number;
  name?: string;
  level?: number;
  rarity?: string;
  operations?: Operation[];
  abilities_base?: Record<string, unknown>[];
  abilities_added?: number[] | null;
  inventory?: { coins?: Record<string, number>; items?: InventoryItem[] };
  details?: Record<string, unknown>;
};

interface InventoryItem {
  id: string;
  item: Record<string, unknown> & { id?: number; name?: string; traits?: number[]; meta_data?: StrikeItemMeta };
  is_formula?: boolean;
  is_equipped?: boolean;
  is_invested?: boolean;
  is_implanted?: boolean;
  container_contents?: unknown[];
}

// ── Lookups ───────────────────────────────────────────────────────────────────

type Row = { id: number; name: string; content_source_id?: number } & Record<string, unknown>;

const nameCache = new Map<string, Map<number, Row>>();

function cacheFor(endpoint: string): Map<number, Row> {
  let cache = nameCache.get(endpoint);
  if (!cache) nameCache.set(endpoint, (cache = new Map()));
  return cache;
}

/** Fetch rows by ID (batched, cached). */
async function rowsById(endpoint: string, ids: number[]): Promise<Map<number, Row>> {
  const cache = cacheFor(endpoint);
  const missing = [...new Set(ids)].filter((id) => !cache.has(id));
  if (missing.length) {
    for (const row of toArray(await wgFetch<Row | Row[]>(endpoint, { id: missing }))) cache.set(row.id, row);
  }
  return new Map(ids.filter((id) => cache.has(id)).map((id) => [id, cache.get(id)!]));
}

/** Exact (case-insensitive) name lookup, preferring official published sources. */
async function rowByName(endpoint: string, name: string, filter?: (r: Row) => boolean): Promise<Row | null> {
  let rows = toArray(await wgFetch<Row | Row[]>(endpoint, { name }));
  if (filter) rows = rows.filter(filter);
  if (!rows.length) return null;
  const official = new Set(await getOfficialSourceIds());
  const row = rows.find((r) => r.content_source_id !== undefined && official.has(r.content_source_id)) ?? rows[0];
  cacheFor(endpoint).set(row.id, row);
  return row;
}

interface Resolver {
  warnings: string[];
}

/** Resolve refs to IDs + names. Unknown names are reported as warnings and dropped. */
async function resolveRefs(endpoint: string, refs: Ref[] | undefined, kind: string, ctx: Resolver) {
  const out: { id: number; name: string }[] = [];
  const idsNeedingNames: number[] = [];
  for (const ref of refs ?? []) {
    if (typeof ref === 'number') idsNeedingNames.push(ref);
    else if (typeof ref === 'object') {
      if (ref.name) out.push({ id: ref.id, name: ref.name });
      else idsNeedingNames.push(ref.id);
    } else if (/^\d+$/.test(ref)) idsNeedingNames.push(Number(ref));
    else {
      const row = await rowByName(endpoint, ref);
      if (row) out.push({ id: row.id, name: row.name });
      else ctx.warnings.push(`Unknown ${kind} "${ref}" was skipped.`);
    }
  }
  if (idsNeedingNames.length) {
    const rows = await rowsById(endpoint, idsNeedingNames);
    for (const id of idsNeedingNames) {
      const row = rows.get(id);
      // IDs the API can't return (e.g. trait 2924 on some legacy creatures) make WG log "not found"
      if (row) out.push({ id, name: row.name });
      else ctx.warnings.push(`Unknown ${kind} ID ${id} was dropped.`);
    }
  }
  return out;
}

// ── Text helpers ──────────────────────────────────────────────────────────────

const ACTION_SYMBOL: Record<string, string> = {
  'ONE-ACTION': '◆',
  'TWO-ACTIONS': '◆◆',
  'THREE-ACTIONS': '◆◆◆',
  REACTION: '↺',
  'FREE-ACTION': '◇',
  'ONE-TO-TWO-ACTIONS': '◆–◆◆',
  'ONE-TO-THREE-ACTIONS': '◆–◆◆◆',
  'TWO-TO-THREE-ACTIONS': '◆◆–◆◆◆',
};

/** Strip Foundry/WG markup from rules text: @Check[will|dc:24] → DC 24 Will, [[Dazzled]] → Dazzled. */
export function cleanRulesText(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/\\([[\]])/g, '$1')
    .replace(/@\w+\[[^\]]*\]\{([^}]+)\}/g, '$1')
    .replace(/@Check\[(\w+)\|dc:(\d+)[^\]]*\]/gi, (_m, save: string, dc: string) => `DC ${dc} ${save[0].toUpperCase()}${save.slice(1)}`)
    .replace(/@Damage\[\(?([^\]|]+?)\)?(?:\|[^\]]*)?\]/g, '$1')
    .replace(/@Template\[[^\]]*type:(\w+)\|distance:(\d+)[^\]]*\]/g, '$2-foot $1')
    .replace(/@\w+\[[^\]]*\]/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\(link_[^)]+\)/g, '$1')
    .replace(/\)[a-z ]*\{[^}]*\}/gi, (m) => m.replace(/\{[^}]*\}/, ''))
    .replace(/\{[^}]*\}/g, '')
    .replace(/^\s*\* \* \*\s*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function firstParagraph(text: string, max = 350): string {
  const para = text.split(/\n\s*\n|\n\* \* \*/)[0].trim();
  return para.length > max ? `${para.slice(0, max).replace(/\s+\S*$/, '')}…` : para;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

/** "fire 5" / "fire, 5" → "fire, 5"; "poison, " → "poison" */
function listEntry(raw: string): string {
  const s = raw.trim().replace(/,\s*$/, '');
  if (/,\s*\d+$/.test(s)) return s;
  const m = s.match(/^(.+?)\s+(\d+)$/);
  return m ? `${m[1]}, ${m[2]}` : s;
}

function displayListEntry(raw: string): string {
  return listEntry(raw).replace(/,\s*(\d+)$/, ' $1');
}

function parseSense(raw: string): { variable: string; value: string } {
  const m = raw.trim().match(/^(.+?)(?:\s*\((precise|imprecise|vague)\))?(?:[\s,]+(\d+)(?:\s*(?:feet|ft\.?))?)?$/i);
  const name = (m?.[1] ?? raw).trim();
  const acuity = (m?.[2] ?? 'precise').toUpperCase();
  const range = m?.[3];
  return { variable: `SENSES_${acuity}`, value: range ? `${name}, ${range}` : name };
}

function formatSense(variable: string, value: string): string {
  const [name, range] = value.split(/,\s*/);
  const acuity = variable.replace('SENSES_', '').toLowerCase();
  return `${name.trim()}${acuity !== 'precise' ? ` (${acuity})` : ''}${range ? ` ${range} feet` : ''}`;
}

function skillVariable(label: string): { variable: string; lore: boolean } | null {
  const trimmed = label.trim();
  const lore = /\blore$/i.test(trimmed);
  const key = trimmed.replace(/\s*lore$/i, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (lore) return { variable: `SKILL_LORE_${key}`, lore: true };
  return SKILL_ATTRIBUTE[key] ? { variable: `SKILL_${key}`, lore: false } : null;
}

function parseDamage(damage: string): { dice: number; die: string; bonus: number; type: string; plus: string[] } | null {
  const m = damage.trim().match(/^(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*([a-z][a-z -]*?)?(?:\s+plus\s+(.+))?$/i);
  if (!m) return null;
  return {
    dice: Number(m[1]),
    die: `d${m[2]}`,
    bonus: m[3] ? Number(`${m[3]}${m[4]}`) : 0,
    type: (m[5] ?? '').trim().toLowerCase(),
    plus: m[6] ? m[6].split(/\s+(?:and|plus)\s+|,\s*/).map((s) => s.trim()).filter(Boolean) : [],
  };
}

function formatDamage(dice: number, die: string, bonus: number, type: string): string {
  return `${dice}${die}${bonus ? signed(bonus) : ''}${type ? ` ${type}` : ''}`;
}

function newOp(type: string, data: Record<string, unknown>): Operation {
  return { id: randomUUID(), type, data };
}

// ── Decompile: WG creature → stat block ───────────────────────────────────────

const STAT_VARIABLES = new Set([
  'AC_BONUS',
  'MAX_HEALTH_BONUS',
  'SAVE_FORT',
  'SAVE_REFLEX',
  'SAVE_WILL',
  'PERCEPTION',
  'SPELL_DC',
  'SPELL_ATTACK',
  'ATTACK_ROLLS_BONUS',
  'ATTACK_DAMAGE_BONUS',
]);

function isModeledOp(op: Operation): boolean {
  const v = op.data?.variable as string | undefined;
  switch (op.type) {
    case 'setValue':
      return !!v && (/^ATTRIBUTE_/.test(v) || v === 'SIZE' || /^SPEED(_|$)/.test(v));
    case 'adjValue':
      return !!v && (STAT_VARIABLES.has(v) || /^SKILL_/.test(v) || /^(IMMUNITIES|WEAKNESSES|RESISTANCES)$/.test(v) || /^SENSES_/.test(v));
    case 'addBonusToValue':
      // Numeric bonuses on modeled stats are folded into totals; notes on AC/HP/saves/perception are kept as notes
      if (!v) return false;
      if (op.data?.text) return /^(AC_BONUS|MAX_HEALTH_BONUS|SAVE_FORT|SAVE_REFLEX|SAVE_WILL|PERCEPTION)$/.test(v);
      return STAT_VARIABLES.has(v) || /^SKILL_/.test(v);
    case 'createValue':
      return !!v && /^SKILL_LORE_/.test(v);
    case 'giveTrait':
    case 'giveLanguage':
    case 'giveSpell':
    case 'giveSpellSlot':
    case 'defineCastingSource':
      return true;
    default:
      return false;
  }
}

export async function decompileCreature(c: Creature): Promise<StatBlock> {
  const ops = c.operations ?? [];
  const level = c.level === NO_LEVEL ? 0 : (c.level ?? 0);
  const totals = computeTotals(level, ops);
  const attrs = totals.attributes;

  const traitIds = ops.filter((o) => o.type === 'giveTrait').map((o) => Number(o.data?.traitId));
  const languageIds = ops.filter((o) => o.type === 'giveLanguage').map((o) => Number(o.data?.languageId));
  const spellOps = ops.filter((o) => o.type === 'giveSpell');
  const items = c.inventory?.items ?? [];
  const itemTraitIds = items.flatMap((i) => i.item.traits ?? []);
  const abilityTraitIds = (c.abilities_base ?? []).flatMap((a) => (a.traits as number[] | undefined) ?? []);
  const giveItemIds = ops.filter((o) => o.type === 'giveItem').map((o) => Number(o.data?.itemId));

  const [traitRows, languageRows, spellRows, itemRows] = await Promise.all([
    rowsById('find-trait', [...traitIds, ...itemTraitIds, ...abilityTraitIds]),
    rowsById('find-language', languageIds),
    rowsById('find-spell', spellOps.map((o) => Number(o.data?.spellId))),
    rowsById('find-item', giveItemIds),
  ]);
  const traitRef = (id: number) => ({ id, name: traitRows.get(id)?.name ?? `#${id}` });

  const valueOf = (type: string, variable: string) =>
    ops.find((o) => o.type === type && o.data?.variable === variable)?.data?.value;
  const listOf = (variable: string) =>
    ops.filter((o) => o.type === 'adjValue' && o.data?.variable === variable).map((o) => displayListEntry(String(o.data?.value ?? '')));

  // Strikes vs. equipment
  const strikes: Strike[] = [];
  const equipment: ItemRef[] = [];
  for (const inv of items) {
    const meta = inv.item.meta_data;
    // Strikes carry a damage die; gear like torches has damage data without one
    if (meta?.damage?.die) {
      const traits = (inv.item.traits ?? []).map(traitRef);
      const t = computeStrike(meta, traits.map((tr) => tr.name.toLowerCase()), attrs, ops);
      strikes.push({
        name: String(inv.item.name ?? 'Strike'),
        type: t.ranged ? 'ranged' : 'melee',
        attack: t.attack,
        damage: formatDamage(t.dice, t.die, t.damageBonus, t.damageType),
        traits,
        range: t.ranged ? Number(meta.range) : undefined,
        reload: meta.reload && meta.reload !== 'null' ? Number(meta.reload) : undefined,
        effects: t.effects ? t.effects.split(/\s*\+\s*/).filter(Boolean) : undefined,
        _item: inv as unknown as Record<string, unknown>,
      });
    } else {
      equipment.push({ id: inv.item.id, name: inv.item.name, quantity: Number((meta as { quantity?: number } | undefined)?.quantity ?? 1), _raw: inv as unknown as Record<string, unknown> });
    }
  }
  for (const id of giveItemIds) equipment.push({ id, name: itemRows.get(id)?.name ?? `#${id}` });

  // Spellcasting, grouped by casting source
  const sourceDefs = new Map<string, { type: string; tradition: string }>();
  for (const op of ops.filter((o) => o.type === 'defineCastingSource')) {
    const [name, type, tradition] = String(op.data?.value ?? '').split(':::');
    sourceDefs.set(name, { type, tradition });
  }
  const bySource = new Map<string, Operation[]>();
  for (const op of spellOps) {
    const source = String(op.data?.castingSource ?? 'SPELLS');
    bySource.set(source, [...(bySource.get(source) ?? []), op]);
  }
  const spellcasting: Spellcasting[] = [];
  for (const [source, sOps] of bySource) {
    const def = sourceDefs.get(source);
    const giveType = String(sOps[0].data?.type ?? 'NORMAL');
    const type: Spellcasting['type'] =
      giveType === 'INNATE' || /INNATE/.test(source)
        ? 'innate'
        : giveType === 'FOCUS' || def?.type === '-'
          ? 'focus'
          : source === 'RITUALS'
            ? 'ritual'
            : def?.type === 'PREPARED-TRADITION' || /PREPARED/.test(source)
              ? 'prepared'
              : 'spontaneous';
    const tradition = String(sOps[0].data?.tradition ?? def?.tradition ?? '').toLowerCase() as Spellcasting['tradition'];
    const slotOps = ops.filter((o) => o.type === 'giveSpellSlot' && o.data?.castingSource === source);
    const slots = slotOps.flatMap((o) => {
      const all = (o.data?.slots as { lvl: number; rank: number; amt: number }[]) ?? [];
      const atLevel = all.find((s) => s.lvl === Math.max(1, level)) ?? all[0];
      return atLevel ? [{ rank: atLevel.rank, amount: atLevel.amt }] : [];
    });
    spellcasting.push({
      type,
      tradition: tradition || undefined,
      dc: totals.spellDc ?? undefined,
      attack: totals.spellAttack ?? undefined,
      spells: sOps.map((o) => {
        const row = spellRows.get(Number(o.data?.spellId));
        const baseRank = Number((row as { rank?: number } | undefined)?.rank ?? 0);
        const casts = Number(o.data?.casts ?? 1);
        return {
          id: Number(o.data?.spellId),
          name: row?.name ?? `#${o.data?.spellId}`,
          // Cantrips without an explicit rank auto-heighten to half the level, rounded up
          rank: o.data?.rank !== undefined ? Number(o.data.rank) : baseRank === 0 ? Math.max(1, Math.ceil(level / 2)) : baseRank,
          cantrip: baseRank === 0,
          casts_per_day: type === 'innate' ? (casts === 0 ? 'at-will' : casts) : undefined,
        } satisfies SpellRef;
      }),
      slots: slots.length ? slots : undefined,
    });
  }

  const notes: StatBlock['notes'] = {};
  const noteMap: [keyof NonNullable<StatBlock['notes']>, string][] = [
    ['ac', 'AC_BONUS'],
    ['hp', 'MAX_HEALTH_BONUS'],
    ['fort', 'SAVE_FORT'],
    ['ref', 'SAVE_REFLEX'],
    ['will', 'SAVE_WILL'],
    ['perception', 'PERCEPTION'],
  ];
  for (const [key, variable] of noteMap) {
    const n = conditionalNotes(ops, variable);
    if (n.length) notes[key] = n;
  }
  // The importer writes "all saves" notes to each save; collapse identical ones
  if (notes.fort && notes.ref && notes.will) {
    const shared = notes.fort.filter((n) => notes.ref!.includes(n) && notes.will!.includes(n));
    if (shared.length) {
      notes.saves = shared;
      for (const k of ['fort', 'ref', 'will'] as const) {
        notes[k] = notes[k]!.filter((n) => !shared.includes(n));
        if (!notes[k]!.length) delete notes[k];
      }
    }
  }

  const speeds: NonNullable<StatBlock['speeds']> = {};
  for (const [key, variable] of [['land', 'SPEED'], ['fly', 'SPEED_FLY'], ['swim', 'SPEED_SWIM'], ['climb', 'SPEED_CLIMB'], ['burrow', 'SPEED_BURROW']] as const) {
    const v = valueOf('setValue', variable);
    if (typeof v === 'number' && (v > 0 || key === 'land')) speeds[key] = v;
  }

  const senses = ops
    .filter((o) => o.type === 'adjValue' && /^SENSES_/.test(String(o.data?.variable)))
    .map((o) => formatSense(String(o.data!.variable), String(o.data!.value ?? '')));

  return {
    name: String(c.name ?? ''),
    level: c.level ?? 0,
    rarity: (c.rarity as StatBlock['rarity']) ?? 'COMMON',
    size: (valueOf('setValue', 'SIZE') as StatBlock['size']) ?? undefined,
    traits: traitIds.map(traitRef),
    description: String(c.details?.description ?? ''),
    image_url: (c.details?.image_url as string | undefined) ?? undefined,
    attributes: Object.fromEntries(ATTRIBUTES.map((a) => [a.toLowerCase(), attrs[a]])) as StatBlock['attributes'],
    perception: totals.perception,
    senses,
    languages: languageIds.map((id) => ({ id, name: languageRows.get(id)?.name ?? `#${id}` })),
    skills: Object.fromEntries(totals.skills.map((s) => [s.label, s.total])),
    ac: totals.ac,
    saves: { fort: totals.fort, ref: totals.reflex, will: totals.will },
    hp: totals.hp,
    notes: Object.keys(notes).length ? notes : undefined,
    immunities: listOf('IMMUNITIES'),
    weaknesses: listOf('WEAKNESSES'),
    resistances: listOf('RESISTANCES'),
    speeds,
    strikes,
    spellcasting,
    items: equipment,
    abilities: (c.abilities_base ?? []).map((a) => ({
      name: String(a.name ?? ''),
      actions: (a.actions as ActionCost) ?? null,
      traits: ((a.traits as number[] | undefined) ?? []).map(traitRef),
      trigger: (a.trigger as string) || undefined,
      requirements: (a.requirements as string) || undefined,
      frequency: (a.frequency as string) || undefined,
      description: (a.description as string) || undefined,
      _raw: a,
    })),
    _extra_ops: ops.filter((o) => !isModeledOp(o)),
    _base: c,
  };
}

// ── Format stat block as text ─────────────────────────────────────────────────

function refName(ref: Ref): string {
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'number') return `#${ref}`;
  return ref.name ?? `#${ref.id}`;
}

export function formatStatBlock(b: StatBlock, opts: { id?: number; fullDescription?: boolean } = {}): string {
  const lines: string[] = [];
  const tags = [b.rarity && b.rarity !== 'COMMON' ? b.rarity : null, b.size ? titleCase(b.size) : null].filter(Boolean);
  const level = b.level === NO_LEVEL ? 'companion (uses party level)' : `Creature ${b.level}`;
  lines.push(`**${b.name}** — ${level}${tags.length ? ` (${tags.join(', ')})` : ''}${opts.id !== undefined ? ` (ID: ${opts.id})` : ''}`);
  if (b.traits?.length) lines.push(`Traits: ${b.traits.map(refName).join(', ')}`);

  const perception = [`Perception ${signed(b.perception)}`];
  if (b.senses?.length) perception.push(b.senses.join(', '));
  if (b.notes?.perception?.length) perception.push(b.notes.perception.join('; '));
  lines.push(perception.join('; '));
  if (b.languages?.length) lines.push(`Languages: ${b.languages.map(refName).join(', ')}`);
  const skills = Object.entries(b.skills ?? {});
  if (skills.length) lines.push(`Skills: ${skills.map(([k, v]) => `${k} ${signed(v)}`).join(', ')}`);
  const a = b.attributes ?? {};
  lines.push(ATTRIBUTES.map((k) => `${titleCase(k)} ${signed(a[k.toLowerCase() as Lowercase<Attribute>] ?? 0)}`).join(', '));
  if (b.items?.length) lines.push(`Items: ${b.items.map((i) => `${i.name ?? `#${i.id}`}${i.quantity && i.quantity > 1 ? ` (${i.quantity})` : ''}`).join(', ')}`);

  const saveNote = (k: 'fort' | 'ref' | 'will') => (b.notes?.[k]?.length ? ` (${b.notes[k]!.join('; ')})` : '');
  const defense = [`AC ${b.ac}${b.notes?.ac?.length ? ` (${b.notes.ac.join('; ')})` : ''}`,
    `Fort ${signed(b.saves.fort)}${saveNote('fort')}, Ref ${signed(b.saves.ref)}${saveNote('ref')}, Will ${signed(b.saves.will)}${saveNote('will')}${b.notes?.saves?.length ? `; ${b.notes.saves.join('; ')}` : ''}`];
  lines.push(defense.join('; '));
  const hp = [`HP ${b.hp}${b.notes?.hp?.length ? ` (${b.notes.hp.join('; ')})` : ''}`];
  if (b.immunities?.length) hp.push(`Immunities ${b.immunities.join(', ')}`);
  if (b.weaknesses?.length) hp.push(`Weaknesses ${b.weaknesses.join(', ')}`);
  if (b.resistances?.length) hp.push(`Resistances ${b.resistances.join(', ')}`);
  lines.push(hp.join('; '));

  const s = b.speeds ?? {};
  const speeds = [s.land !== undefined ? `${s.land} feet` : null, ...(['fly', 'swim', 'climb', 'burrow'] as const).map((k) => (s[k] ? `${k} ${s[k]} feet` : null))].filter(Boolean);
  if (speeds.length) lines.push(`Speed ${speeds.join(', ')}`);

  for (const st of b.strikes ?? []) {
    const traits = (st.traits ?? []).map(refName);
    const agile = traits.some((t) => t.toLowerCase() === 'agile');
    const map = agile ? [st.attack - 4, st.attack - 8] : [st.attack - 5, st.attack - 10];
    const extras = [st.range ? `range ${st.range} feet` : null, st.reload !== undefined ? `reload ${st.reload}` : null, ...traits].filter(Boolean);
    const effects = st.effects?.length ? ` plus ${st.effects.join(' and ')}` : '';
    lines.push(`${st.type === 'ranged' ? 'Ranged' : 'Melee'} ◆ ${st.name} ${signed(st.attack)} [${map.map(signed).join('/')}]${extras.length ? ` (${extras.join(', ')})` : ''}, Damage ${st.damage}${effects}`);
  }

  for (const sc of b.spellcasting ?? []) {
    const header = `${titleCase(sc.tradition ?? '')} ${titleCase(sc.type)} Spells`.trim();
    const dc = [sc.dc !== undefined ? `DC ${sc.dc}` : null, sc.attack !== undefined ? `attack ${signed(sc.attack)}` : null].filter(Boolean).join(', ');
    const groups = new Map<string, string[]>();
    for (const sp of sc.spells) {
      const key = sp.cantrip ? `Cantrips (${ordinal(Math.max(sp.rank, 1))})` : sc.type === 'ritual' ? `${ordinal(sp.rank)}` : ordinal(sp.rank);
      const casts = sp.casts_per_day === 'at-will' ? ' (at will)' : sp.casts_per_day === 'constant' ? ' (constant)' : typeof sp.casts_per_day === 'number' && sp.casts_per_day > 1 ? ` (×${sp.casts_per_day})` : '';
      groups.set(key, [...(groups.get(key) ?? []), `${sp.name ?? `#${sp.id}`}${casts}`]);
    }
    const slotFor = (rank: string) => sc.slots?.find((sl) => ordinal(sl.rank) === rank)?.amount;
    const order = [...groups.keys()].sort((x, y) => (x.startsWith('Cantrips') ? -1 : y.startsWith('Cantrips') ? 1 : parseInt(y) - parseInt(x)));
    const parts = order.map((k) => `**${k}**${slotFor(k) ? ` (${slotFor(k)} slots)` : ''} ${groups.get(k)!.join(', ')}`);
    lines.push(`${header}${dc ? ` ${dc}` : ''}; ${parts.join('; ')}`);
  }

  if (b.abilities?.length) {
    lines.push('\nAbilities:');
    for (const ab of b.abilities) {
      const sym = ab.actions ? `${ACTION_SYMBOL[ab.actions] ?? ab.actions} ` : '';
      const traits = (ab.traits ?? []).map(refName);
      const meta = [ab.frequency ? `Frequency ${cleanRulesText(ab.frequency)}` : null, ab.trigger ? `Trigger ${cleanRulesText(ab.trigger)}` : null, ab.requirements ? `Requirements ${cleanRulesText(ab.requirements)}` : null].filter(Boolean).join('; ');
      // Monster Core standard abilities are stored as glossary keys ("ReactiveStrike")
      const text = cleanRulesText(ab.description).replace(/\n/g, ' ');
      const desc = /^[A-Z][A-Za-z]+$/.test(text) ? '(standard creature ability, see the GM Core glossary)' : text;
      lines.push(`  **${sym}${ab.name}**${traits.length ? ` (${traits.join(', ')})` : ''}${meta ? ` ${meta};` : ''}${desc ? ` ${desc}` : ''}`);
    }
  }

  const desc = cleanRulesText(b.description);
  if (desc) lines.push(`\n${opts.fullDescription ? desc : firstParagraph(desc)}`);
  return lines.join('\n');
}

// ── Build: stat block → WG creature ───────────────────────────────────────────

function attributesOf(b: StatBlock): Attributes {
  const a = b.attributes ?? {};
  return Object.fromEntries(ATTRIBUTES.map((k) => [k, a[k.toLowerCase() as Lowercase<Attribute>] ?? 0])) as Attributes;
}

async function buildStrikeItem(st: Strike, attrs: Attributes, ctx: Resolver): Promise<InventoryItem | null> {
  const parsed = parseDamage(st.damage);
  if (!parsed) {
    ctx.warnings.push(`Strike "${st.name}": could not parse damage "${st.damage}" (expected e.g. "2d6+4 slashing"); skipped.`);
    return null;
  }
  const traits = await resolveRefs('find-trait', st.traits, 'trait', ctx);
  const traitNames = traits.map((t) => t.name.toLowerCase());
  let range = st.range;
  if (st.type === 'ranged' && !range) {
    range = 30;
    ctx.warnings.push(`Strike "${st.name}" is ranged but has no range; defaulted to 30 feet.`);
  }
  const ranged = !!range;
  const sel = strikeAttributes(ranged, traitNames);
  const attrMod = Math.max(...sel.attack.map((a) => attrs[a]));
  const strPart = sel.damage === 'full' ? attrs.STR : sel.damage === 'half' ? (attrs.STR > 0 ? Math.floor(attrs.STR / 2) : attrs.STR) : 0;
  const effects = [...parsed.plus, ...(st.effects ?? [])];
  const extra = `${parsed.bonus - strPart}${effects.length ? ` + ${effects.join(' + ')}` : ''}`;

  const baseInv = st._item as unknown as InventoryItem | undefined;
  const baseMeta = (baseInv?.item.meta_data ?? {}) as StrikeItemMeta;
  const item = {
    ...(baseInv?.item ?? {
      id: Math.floor(Math.random() * 1e15),
      created_at: '',
      level: 0,
      rarity: 'COMMON',
      description: '',
      group: 'WEAPON',
      size: 'MEDIUM',
      operations: [],
      price: null,
      bulk: null,
      hands: null,
      craft_requirements: null,
      usage: null,
      version: '',
    }),
    name: st.name,
    traits: traits.map((t) => t.id),
    meta_data: {
      category: 'unarmed_attack',
      group: 'brawling',
      bulk: {},
      unselectable: true,
      quantity: 1,
      foundry: {},
      ...baseMeta,
      damage: { damageType: parsed.type, dice: parsed.dice, die: parsed.die, extra },
      attack_bonus: st.attack - attrMod,
      range: range ?? undefined,
      reload: st.reload !== undefined ? `${st.reload}` : undefined,
    },
  };
  return {
    id: baseInv?.id ?? randomUUID(),
    item,
    is_formula: false,
    is_equipped: true,
    is_invested: false,
    is_implanted: false,
    container_contents: [],
  };
}

async function buildItem(ref: ItemRef, ctx: Resolver): Promise<InventoryItem | null> {
  if (ref._raw) return ref._raw as unknown as InventoryItem;
  let row: Row | null = null;
  if (ref.id !== undefined) row = (await rowsById('find-item', [ref.id])).get(ref.id) ?? null;
  else if (ref.name) row = await rowByName('find-item', ref.name);
  if (!row) {
    ctx.warnings.push(`Unknown item "${ref.name ?? ref.id}" was skipped.`);
    return null;
  }
  const item = structuredClone(row) as InventoryItem['item'];
  const meta = (item.meta_data ?? {}) as Record<string, unknown>;
  item.meta_data = { ...meta, hp: meta.hp_max, quantity: ref.quantity ?? 1 };
  // Left unequipped like WG's importer, so armor/weapon stats don't shift the creature's numbers
  return { id: randomUUID(), item, is_formula: false, is_equipped: false, is_invested: false, is_implanted: false, container_contents: [] };
}

/** Fill every field WG's ability blocks carry, keeping any provided values. */
function normalizeAbility(raw: Record<string, unknown>, level: number): Record<string, unknown> {
  return {
    id: -1,
    created_at: '',
    actions: null,
    level,
    rarity: 'COMMON',
    frequency: null,
    trigger: null,
    requirements: null,
    description: '',
    special: null,
    prerequisites: null,
    type: 'action',
    traits: [],
    operations: null,
    cost: null,
    access: null,
    meta_data: null,
    version: '1.0',
    ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)),
  };
}

async function buildAbility(ab: AbilityInput, level: number, ctx: Resolver): Promise<Record<string, unknown> | null> {
  if (ab._raw) return normalizeAbility(ab._raw, level);
  if (ab.from_creature !== undefined) {
    const query = typeof ab.from_creature === 'number' || /^d+$/.test(ab.from_creature)
      ? { id: Number(ab.from_creature) }
      : { name: ab.from_creature };
    const [source] = toArray(await wgFetch<Creature | Creature[]>('find-creature', query));
    const found = source?.abilities_base?.find((a) => String(a.name).toLowerCase() === ab.name.toLowerCase());
    if (!found) {
      ctx.warnings.push(`Ability "${ab.name}" not found on creature "${ab.from_creature}"; skipped.`);
      return null;
    }
    return { ...found, level };
  }
  if (ab.existing) {
    // Prefer actions, then feats; class features describe player options ("you gain …")
    let row = await rowByName('find-ability-block', ab.name, (r) => r.type === 'action');
    row ??= await rowByName('find-ability-block', ab.name, (r) => r.type === 'feat');
    row ??= await rowByName('find-ability-block', ab.name);
    if (!row) {
      ctx.warnings.push(`Unknown existing ability "${ab.name}"; add a description to define it as a custom ability.`);
      return null;
    }
    if (row.type !== 'action') {
      ctx.warnings.push(`"${ab.name}" was copied from a player ${row.type}; its text may be written for characters. Consider from_creature (copy from a creature that has it) or a custom description.`);
    }
    // Operations are dropped so the ability can't shift the stat block's exact numbers
    return { ...row, operations: [] };
  }
  const traits = await resolveRefs('find-trait', ab.traits, 'trait', ctx);
  return {
    id: -1,
    created_at: '',
    name: ab.name,
    actions: ab.actions ?? null,
    level,
    rarity: 'COMMON',
    frequency: ab.frequency ?? null,
    trigger: ab.trigger ?? null,
    requirements: ab.requirements ?? null,
    description: ab.description ?? '',
    special: null,
    prerequisites: null,
    type: 'action',
    traits: traits.map((t) => t.id),
    operations: null,
    cost: null,
    access: null,
    meta_data: null,
    version: '1.0',
  };
}

async function buildSpellcasting(b: StatBlock, attrs: Attributes, ctx: Resolver): Promise<Operation[]> {
  const ops: Operation[] = [];
  const entries = b.spellcasting ?? [];
  if (!entries.length) return ops;

  const castingType: Record<Spellcasting['type'], string | null> = {
    innate: null,
    focus: '-',
    prepared: 'PREPARED-TRADITION',
    spontaneous: 'SPONTANEOUS-REPERTOIRE',
    ritual: null,
  };

  for (const entry of entries) {
    const tradition = (entry.tradition ?? (entry.type === 'focus' || entry.type === 'ritual' ? 'arcane' : undefined))?.toUpperCase();
    if (!tradition) ctx.warnings.push(`${entry.type} spellcasting has no tradition; defaulted to arcane.`);
    const trad = tradition ?? 'ARCANE';
    const source = entry.type === 'ritual' ? 'RITUALS' : `${b.name} ${titleCase(entry.type)}`.toUpperCase();
    if (entry.type !== 'ritual') {
      ops.push(newOp('defineCastingSource', { variable: 'CASTING_SOURCES', value: `${source}:::${castingType[entry.type]}:::${trad}:::ATTRIBUTE_CHA` }));
    }
    const rankCounts = new Map<number, number>();
    for (const sp of entry.spells) {
      let id = sp.id;
      if (id === undefined && sp.name) id = (await rowByName('find-spell', sp.name))?.id;
      if (id === undefined) {
        ctx.warnings.push(`Unknown spell "${sp.name}" was skipped.`);
        continue;
      }
      const casts = sp.casts_per_day === 'at-will' || sp.casts_per_day === 'constant' ? 0 : (sp.casts_per_day ?? 1);
      ops.push(newOp('giveSpell', {
        spellId: id,
        type: entry.type === 'innate' ? 'INNATE' : entry.type === 'focus' ? 'FOCUS' : 'NORMAL',
        castingSource: source,
        rank: sp.rank,
        tradition: trad,
        casts,
      }));
      rankCounts.set(sp.rank, (rankCounts.get(sp.rank) ?? 0) + 1);
    }
    const slots = entry.type === 'spontaneous'
      ? (entry.slots ?? [...rankCounts.entries()].map(([rank]) => ({ rank, amount: rank === 0 ? 5 : 3 })))
      : entry.type === 'prepared'
        ? (entry.slots ?? [...rankCounts.entries()].map(([rank, amount]) => ({ rank, amount })))
        : [];
    for (const slot of slots) {
      ops.push(newOp('giveSpellSlot', {
        castingSource: source,
        slots: Array.from({ length: 20 }, (_, i) => ({ lvl: i + 1, rank: slot.rank, amt: slot.amount })),
      }));
    }
  }

  // The engine has a single spell DC/attack; use the highest given
  const dcs = entries.map((e) => e.dc ?? (e.attack !== undefined ? e.attack + 10 : undefined)).filter((n): n is number => n !== undefined);
  const attacks = entries.map((e) => e.attack ?? (e.dc !== undefined ? e.dc - 10 : undefined)).filter((n): n is number => n !== undefined);
  if (new Set(dcs).size > 1) ctx.warnings.push(`Wanderer's Guide supports one spell DC per creature; using DC ${Math.max(...dcs)}.`);
  const hasInnate = entries.some((e) => e.type === 'innate' && e.spells.length);
  const cha = attrs.CHA + spellProficiency(b.level === NO_LEVEL ? 0 : b.level, hasInnate);
  if (dcs.length) ops.push(newOp('addBonusToValue', { variable: 'SPELL_DC', text: '', value: signed(Math.max(...dcs) - 10 - cha) }));
  if (attacks.length) ops.push(newOp('addBonusToValue', { variable: 'SPELL_ATTACK', text: '', value: signed(Math.max(...attacks) - cha) }));
  return ops;
}

export interface BuildResult {
  creature: Creature;
  warnings: string[];
}

export async function buildCreature(b: StatBlock): Promise<BuildResult> {
  const ctx: Resolver = { warnings: [] };
  const level = b.level;
  const engineLevel = level === NO_LEVEL ? 0 : level;
  const attrs = attributesOf(b);
  const ops: Operation[] = [];

  for (const a of ATTRIBUTES) ops.push(newOp('setValue', { variable: `ATTRIBUTE_${a}`, value: { value: attrs[a], partial: false } }));
  ops.push(newOp('setValue', { variable: 'SIZE', value: b.size ?? 'MEDIUM' }));
  const speeds = b.speeds ?? {};
  ops.push(newOp('setValue', { variable: 'SPEED', value: speeds.land ?? 25 }));
  for (const k of ['fly', 'swim', 'climb', 'burrow'] as const) {
    if (speeds[k]) ops.push(newOp('setValue', { variable: `SPEED_${k.toUpperCase()}`, value: speeds[k] }));
  }

  for (const t of await resolveRefs('find-trait', b.traits, 'trait', ctx)) ops.push(newOp('giveTrait', { traitId: t.id }));
  for (const l of await resolveRefs('find-language', b.languages, 'language', ctx)) ops.push(newOp('giveLanguage', { languageId: l.id }));
  for (const sense of b.senses ?? []) {
    const { variable, value } = parseSense(sense);
    ops.push(newOp('adjValue', { variable, value }));
  }
  for (const [variable, list] of [['IMMUNITIES', b.immunities], ['WEAKNESSES', b.weaknesses], ['RESISTANCES', b.resistances]] as const) {
    for (const entry of list ?? []) if (entry.trim()) ops.push(newOp('adjValue', { variable, value: listEntry(entry) }));
  }

  // Core stats as differences from the engine's derived values
  ops.push(newOp('adjValue', { variable: 'AC_BONUS', value: b.ac - 10 - attrs.DEX }));
  ops.push(newOp('adjValue', { variable: 'MAX_HEALTH_BONUS', value: b.hp - attrs.CON * engineLevel }));
  ops.push(newOp('addBonusToValue', { variable: 'SAVE_FORT', text: '', value: signed(b.saves.fort - attrs.CON) }));
  ops.push(newOp('addBonusToValue', { variable: 'SAVE_REFLEX', text: '', value: signed(b.saves.ref - attrs.DEX) }));
  ops.push(newOp('addBonusToValue', { variable: 'SAVE_WILL', text: '', value: signed(b.saves.will - attrs.WIS) }));
  ops.push(newOp('addBonusToValue', { variable: 'PERCEPTION', text: '', value: signed(b.perception - attrs.WIS) }));

  const noteTargets: Record<string, string[]> = {
    ac: ['AC_BONUS'], hp: ['MAX_HEALTH_BONUS'], perception: ['PERCEPTION'],
    fort: ['SAVE_FORT'], ref: ['SAVE_REFLEX'], will: ['SAVE_WILL'], saves: ['SAVE_FORT', 'SAVE_REFLEX', 'SAVE_WILL'],
  };
  for (const [key, notes] of Object.entries(b.notes ?? {})) {
    for (const note of notes ?? []) for (const variable of noteTargets[key] ?? []) ops.push(newOp('addBonusToValue', { variable, value: undefined, type: undefined, text: note }));
  }

  for (const [label, total] of Object.entries(b.skills ?? {})) {
    const skill = skillVariable(label);
    if (!skill) {
      ctx.warnings.push(`Unknown skill "${label}" was skipped (use a PF2e skill name or "<Topic> Lore").`);
      continue;
    }
    const attr: Attribute = skill.lore ? 'INT' : SKILL_ATTRIBUTE[skill.variable.slice('SKILL_'.length)];
    if (skill.lore) ops.push(newOp('createValue', { variable: skill.variable, type: 'prof', value: { value: 'T', increases: 0, attribute: 'ATTRIBUTE_INT' } }));
    else ops.push(newOp('adjValue', { variable: skill.variable, value: { value: 'T' } }));
    ops.push(newOp('addBonusToValue', { variable: skill.variable, text: '', value: signed(total - 2 - engineLevel - attrs[attr]) }));
  }

  ops.push(...(await buildSpellcasting(b, attrs, ctx)));
  ops.push(...(b._extra_ops ?? []));

  const items: InventoryItem[] = [];
  for (const ref of b.items ?? []) {
    const inv = await buildItem(ref, ctx);
    if (inv) items.push(inv);
  }
  const strikeIds = new Set<string>();
  for (const st of b.strikes ?? []) {
    // A strike named like a carried weapon ("Sickle", "Keen Sickle") becomes that item, as WG's importer does
    const stName = st.name.trim().toLowerCase();
    const index = st._item
      ? -1
      : items.findIndex((i) => {
        const itemName = String(i.item.name ?? '').trim().toLowerCase();
        return !strikeIds.has(i.id) && (itemName === stName || stName.endsWith(` ${itemName}`));
      });
    const carried = index >= 0 ? items[index] : undefined;
    const meta = carried?.item.meta_data as { category?: string; group?: string } | undefined;
    const inv = await buildStrikeItem(
      carried ? { ...st, _item: { id: carried.id, item: { ...carried.item, meta_data: { category: meta?.category, group: meta?.group } } } } : st,
      attrs,
      ctx,
    );
    if (!inv) continue;
    strikeIds.add(inv.id);
    if (index >= 0) items[index] = inv;
    else items.push(inv);
  }
  const abilities: Record<string, unknown>[] = [];
  for (const ab of b.abilities ?? []) {
    const built = await buildAbility(ab, engineLevel, ctx);
    if (built) abilities.push(built);
  }

  const base = b._base ?? {};
  const creature: Creature = {
    ...base,
    id: typeof base.id === 'number' && base.id > 0 ? base.id : Math.floor(Math.random() * 9_000_000) + 1_000_000,
    created_at: (base.created_at as string) ?? '',
    name: b.name,
    level,
    rarity: b.rarity ?? 'COMMON',
    experience: 0,
    hp_current: null,
    hp_temp: 0,
    stamina_current: 0,
    resolve_current: 0,
    inventory: { coins: { cp: 0, sp: 0, gp: 0, pp: 0 }, items },
    notes: null,
    details: { ...((base.details as object) ?? {}), description: b.description ?? '', image_url: b.image_url },
    roll_history: null,
    operations: ops,
    abilities_base: abilities,
    abilities_added: (base.abilities_added as number[] | null) ?? null,
    spells: { slots: [], list: [], focus_point_current: 0, innate_casts: [] },
    meta_data: (base.meta_data as Record<string, unknown> | null) ?? null,
    version: '1.0',
  };
  return { creature, warnings: ctx.warnings };
}

// ── Custom enemy input: full stat block or "existing creature + overrides" ────

function mergeUnique<T>(a: T[] | undefined, b: T[] | undefined, key: (x: T) => string): T[] {
  const out = [...(a ?? [])];
  const seen = new Set(out.map(key));
  for (const x of b ?? []) if (!seen.has(key(x))) out.push(x);
  return out;
}

const refKey = (r: Ref) => refName(r).toLowerCase();

export async function resolveStatBlock(input: StatBlock | BasedStatBlock): Promise<StatBlock> {
  const based = input as BasedStatBlock;
  if (based.base_creature_id === undefined && !based.base_creature_name) return input as StatBlock;

  const body = based.base_creature_id !== undefined ? { id: based.base_creature_id } : { name: based.base_creature_name };
  const [baseCreature] = toArray(await wgFetch<Creature | Creature[]>('find-creature', body));
  if (!baseCreature) throw new Error(`Base creature ${based.base_creature_id ?? `"${based.base_creature_name}"`} not found.`);
  const base = await decompileCreature(baseCreature);

  const removeAbilities = new Set((based.remove_abilities ?? []).map((n) => n.toLowerCase()));
  const removeTraits = new Set((based.remove_traits ?? []).map((n) => n.toLowerCase()));
  const baseAbilities = based.replace_abilities ? [] : (base.abilities ?? []).filter((a) => !removeAbilities.has(a.name.toLowerCase()));

  return {
    ...base,
    name: based.name ?? base.name,
    level: based.level ?? base.level,
    rarity: based.rarity ?? base.rarity,
    size: based.size ?? base.size,
    description: based.description ?? base.description,
    image_url: based.image_url ?? base.image_url,
    attributes: { ...base.attributes, ...based.attributes },
    perception: based.perception ?? base.perception,
    ac: based.ac ?? base.ac,
    hp: based.hp ?? base.hp,
    saves: { ...base.saves, ...based.saves },
    notes: based.notes ?? base.notes,
    skills: { ...base.skills, ...based.skills },
    speeds: { ...base.speeds, ...based.speeds },
    traits: mergeUnique(base.traits, based.traits, refKey).filter((t) => !removeTraits.has(refKey(t))),
    languages: mergeUnique(base.languages, based.languages, refKey),
    senses: mergeUnique(base.senses, based.senses, (s) => s.toLowerCase()),
    immunities: mergeUnique(base.immunities, based.immunities, (s) => s.toLowerCase()),
    weaknesses: mergeUnique(base.weaknesses, based.weaknesses, (s) => s.toLowerCase()),
    resistances: mergeUnique(base.resistances, based.resistances, (s) => s.toLowerCase()),
    strikes: [...(based.replace_strikes ? [] : (base.strikes ?? [])), ...(based.strikes ?? [])],
    spellcasting: [...(based.replace_spellcasting ? [] : (base.spellcasting ?? [])), ...(based.spellcasting ?? [])],
    items: [...(base.items ?? []), ...(based.items ?? [])],
    abilities: [...baseAbilities, ...(based.abilities ?? [])],
    // A renamed/re-levelled copy is a new creature, not the database row
    _base: { ...base._base, id: undefined },
  };
}

/** Build a custom creature and describe the result (stat block + warnings). */
export async function buildCustomCreature(input: StatBlock | BasedStatBlock): Promise<BuildResult & { statBlock: StatBlock }> {
  const block = await resolveStatBlock(input);
  const result = await buildCreature(block);
  // Round-trip through the decompiler so the preview shows what WG will actually compute
  const statBlock = await decompileCreature(result.creature);
  return { ...result, statBlock };
}

/**
 * A creature given in WG's raw format may be incomplete (no inventory, spells, or ability fields,
 * operations without IDs), which the website can fail to render. Rebuild it through the stat block
 * so it has the same complete shape as every other creature.
 */
export async function normalizeRawCreature(raw: Creature): Promise<BuildResult & { statBlock: StatBlock }> {
  const ops = (raw.operations ?? []).map((op) => ({ ...op, id: op.id ?? randomUUID() }));
  const warnings: string[] = [];
  const hasStat = (variable: string) => ops.some((op) => op.data?.variable === variable && op.data?.value !== undefined);
  if (!hasStat('MAX_HEALTH_BONUS') || !hasStat('AC_BONUS')) {
    warnings.push('has no HP or AC operations; its stat block will be mostly empty. Pass custom creatures as a stat block (ac, hp, saves, perception, strikes…) instead of raw operations.');
  }
  const block = await decompileCreature({ ...raw, operations: ops, _base: undefined } as Creature);
  block._base = { ...raw, operations: undefined, inventory: undefined, abilities_base: undefined, spells: undefined };
  const result = await buildCreature(block);
  const statBlock = await decompileCreature(result.creature);
  return { creature: result.creature, warnings: [...warnings, ...result.warnings], statBlock };
}

/** Remove giveTrait operations whose trait the API can't return; returns the dropped IDs. */
export async function dropUnknownTraits(creature: Creature): Promise<number[]> {
  const ids = (creature.operations ?? []).filter((op) => op.type === 'giveTrait').map((op) => Number(op.data?.traitId));
  if (!ids.length) return [];
  const rows = await rowsById('find-trait', ids);
  const unknown = ids.filter((id) => !rows.has(id));
  if (unknown.length) {
    creature.operations = (creature.operations ?? []).filter(
      (op) => !(op.type === 'giveTrait' && unknown.includes(Number(op.data?.traitId))),
    );
  }
  return unknown;
}

export function isStatBlockInput(x: unknown): x is StatBlock | BasedStatBlock {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return !Array.isArray(o.operations) && (o.base_creature_id !== undefined || o.base_creature_name !== undefined || o.ac !== undefined);
}

export function validateStatBlock(b: StatBlock): string[] {
  const missing = (['name', 'level', 'perception', 'ac', 'hp', 'saves'] as const).filter((k) => b[k] === undefined || b[k] === null);
  return missing.length ? [`Custom creature "${b.name ?? '(unnamed)'}" is missing: ${missing.join(', ')}`] : [];
}

