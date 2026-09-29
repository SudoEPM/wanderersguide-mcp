/**
 * Mirrors the parts of Wanderer's Guide's rules engine that determine a creature's displayed stats,
 * so the MCP can show accurate stat blocks and write operations that land on exact target values.
 *
 * Creatures have untrained proficiency everywhere except skills granted `T`, so (per the WG source,
 * variable-helpers.ts / armor-handler.ts / weapon-handler.ts):
 *   HP         = MAX_HEALTH_BONUS + CON × level
 *   AC         = 10 + DEX + AC_BONUS                  (no armor equipped)
 *   Save       = attribute + bonus                    (Fort CON, Reflex DEX, Will WIS)
 *   Perception = WIS + bonus
 *   Skill (T)  = 2 + level + attribute + bonus
 *   Spell DC   = 10 + prof + casting attribute + bonus;  spell attack = prof + casting attribute + bonus,
 *                where prof = 0, or trained (2 + level; expert 4 + level at 12+) once any innate spell is granted
 *   Strike     = best(STR, DEX if finesse) — or DEX if ranged — + item attack_bonus + ATTACK_ROLLS_BONUS
 *   Damage     = STR (melee / thrown) + first number of damage.extra + ATTACK_DAMAGE_BONUS
 */

export interface Operation {
  id?: string;
  type: string;
  data?: Record<string, unknown>;
}

export const ATTRIBUTES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export type Attributes = Record<Attribute, number>;

export const SKILL_ATTRIBUTE: Record<string, Attribute> = {
  ACROBATICS: 'DEX',
  ARCANA: 'INT',
  ATHLETICS: 'STR',
  CRAFTING: 'INT',
  DECEPTION: 'CHA',
  DIPLOMACY: 'CHA',
  INTIMIDATION: 'CHA',
  MEDICINE: 'WIS',
  NATURE: 'WIS',
  OCCULTISM: 'INT',
  PERFORMANCE: 'CHA',
  RELIGION: 'WIS',
  SOCIETY: 'INT',
  STEALTH: 'DEX',
  SURVIVAL: 'WIS',
  THIEVERY: 'DEX',
};

const PROF_VALUE: Record<string, number> = { U: 0, T: 2, E: 4, M: 6, L: 8 };

/** Level used by the engine: companions store -100 and use the character's level instead. */
export const NO_LEVEL = -100;

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function getAttributes(ops: Operation[]): Attributes {
  const attrs: Attributes = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
  for (const op of ops) {
    if (op.type !== 'setValue') continue;
    const variable = op.data?.variable as string | undefined;
    const match = variable?.match(/^ATTRIBUTE_(STR|DEX|CON|INT|WIS|CHA)$/);
    if (!match) continue;
    const raw = op.data?.value as { value?: unknown } | number | undefined;
    const n = parseNumber(typeof raw === 'object' && raw !== null ? raw.value : raw);
    if (n !== null) attrs[match[1] as Attribute] = n;
  }
  return attrs;
}

/** Sum of numeric adjValue + addBonusToValue contributions to a variable (typed stacking ignored). */
export function numericBonus(ops: Operation[], variable: string): number {
  let total = 0;
  for (const op of ops) {
    if (op.data?.variable !== variable) continue;
    if (op.type === 'adjValue' || op.type === 'addBonusToValue') {
      if (op.type === 'addBonusToValue' && op.data?.text) continue; // conditional note, not a number
      const n = parseNumber(op.data?.value);
      if (n !== null) total += n;
    }
  }
  return total;
}

/** Conditional notes attached to a variable (addBonusToValue with text and no numeric value). */
export function conditionalNotes(ops: Operation[], variable: string): string[] {
  return ops
    .filter((op) => op.type === 'addBonusToValue' && op.data?.variable === variable && op.data?.text)
    .map((op) => String(op.data!.text));
}

export interface SkillStat {
  variable: string; // SKILL_STEALTH, SKILL_LORE_UNDERWORLD
  label: string; // Stealth, Underworld Lore
  total: number;
}

export interface CreatureTotals {
  level: number;
  attributes: Attributes;
  hp: number;
  ac: number;
  fort: number;
  reflex: number;
  will: number;
  perception: number;
  skills: SkillStat[];
  spellDc: number | null;
  spellAttack: number | null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function skillLabel(variable: string): string {
  if (variable.startsWith('SKILL_LORE_')) return `${titleCase(variable.slice('SKILL_LORE_'.length))} Lore`;
  return titleCase(variable.slice('SKILL_'.length));
}

/** The attribute the engine uses for spell DC/attack: the first defined casting source's attribute. */
export function castingAttribute(ops: Operation[]): Attribute | null {
  for (const op of ops) {
    if (op.type !== 'defineCastingSource') continue;
    const attr = String(op.data?.value ?? '').split(':::')[3]?.replace('ATTRIBUTE_', '');
    if (attr && (ATTRIBUTES as readonly string[]).includes(attr)) return attr as Attribute;
  }
  return null;
}

/** Proficiency + level part of spell DC/attack: innate spells grant trained (expert at 12+). */
export function spellProficiency(level: number, hasInnate: boolean): number {
  if (!hasInnate) return 0;
  return (level >= 12 ? 4 : 2) + level;
}

export function hasInnateSpells(ops: Operation[]): boolean {
  return ops.some((op) => op.type === 'giveSpell' && op.data?.type === 'INNATE');
}

export function hasSpellcasting(ops: Operation[]): boolean {
  return ops.some((op) => op.type === 'giveSpell' || op.type === 'defineCastingSource');
}

export function computeTotals(level: number, ops: Operation[]): CreatureTotals {
  const attrs = getAttributes(ops);
  const skills: SkillStat[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    const variable = op.data?.variable as string | undefined;
    if (!variable?.startsWith('SKILL_') || seen.has(variable)) continue;
    let prof: string | undefined;
    let attribute: Attribute | undefined;
    if (op.type === 'adjValue' && typeof op.data?.value === 'object') {
      prof = (op.data.value as { value?: string }).value;
      attribute = SKILL_ATTRIBUTE[variable.slice('SKILL_'.length)];
    } else if (op.type === 'createValue' && op.data?.type === 'prof') {
      const v = op.data.value as { value?: string; attribute?: string };
      prof = v.value;
      attribute = (v.attribute?.replace('ATTRIBUTE_', '') as Attribute) ?? 'INT';
    }
    if (!prof || !attribute) continue;
    seen.add(variable);
    const profValue = PROF_VALUE[prof] ?? 0;
    const levelPart = profValue > 0 ? level : 0;
    skills.push({
      variable,
      label: skillLabel(variable),
      total: profValue + levelPart + attrs[attribute] + numericBonus(ops, variable),
    });
  }

  const castAttr = castingAttribute(ops);
  const castMod = (castAttr ? attrs[castAttr] : 0) + spellProficiency(level, hasInnateSpells(ops));
  const spellcasting = hasSpellcasting(ops);

  return {
    level,
    attributes: attrs,
    hp: numericBonus(ops, 'MAX_HEALTH_BONUS') + attrs.CON * level,
    ac: 10 + attrs.DEX + numericBonus(ops, 'AC_BONUS'),
    fort: attrs.CON + numericBonus(ops, 'SAVE_FORT'),
    reflex: attrs.DEX + numericBonus(ops, 'SAVE_REFLEX'),
    will: attrs.WIS + numericBonus(ops, 'SAVE_WILL'),
    perception: attrs.WIS + numericBonus(ops, 'PERCEPTION'),
    skills,
    spellDc: spellcasting ? 10 + castMod + numericBonus(ops, 'SPELL_DC') : null,
    spellAttack: spellcasting ? castMod + numericBonus(ops, 'SPELL_ATTACK') : null,
  };
}

// ── Strikes ───────────────────────────────────────────────────────────────────

export interface StrikeItemMeta {
  damage?: { damageType?: string; dice?: number; die?: string; extra?: string };
  attack_bonus?: number;
  range?: number | string | null;
  reload?: string | null;
  [key: string]: unknown;
}

export interface StrikeTotals {
  ranged: boolean;
  attack: number;
  map: [number, number, number];
  dice: number;
  die: string;
  damageBonus: number;
  damageType: string;
  effects: string; // text remaining in damage.extra after the numeric bonus (e.g. "Improved Grab")
}

/** Split damage.extra the way the engine does: the first standalone number is a flat bonus. */
export function splitDamageExtra(extra: string | undefined): { bonus: number; text: string } {
  let text = (extra ?? '').trim();
  if (text.startsWith('+')) text = text.slice(1).trim();
  let bonus = 0;
  text = text
    .replace(/(([^d]|^)(|-)\d+?)($|\s)/, (_m, group1: string) => {
      bonus = parseInt(group1, 10);
      return '';
    })
    .trim();
  if (text.startsWith('+')) text = text.slice(1).trim();
  return { bonus: Number.isNaN(bonus) ? 0 : bonus, text };
}

/** Strike attribute selection; `traitNames` are lowercase trait names on the weapon. */
export function strikeAttributes(ranged: boolean, traitNames: string[]) {
  const has = (t: string) => traitNames.includes(t);
  const thrown = traitNames.some((t) => t.startsWith('thrown'));
  const attack: Attribute[] = ranged ? [has('brutal') ? 'STR' : 'DEX'] : has('finesse') ? ['STR', 'DEX'] : ['STR'];
  const splash = has('splash');
  const usesStrength = ranged ? thrown && !splash : !splash;
  const propulsive = ranged && has('propulsive');
  return { attack, damage: usesStrength ? 'full' : propulsive ? 'half' : 'none', agile: has('agile') } as const;
}

export function computeStrike(meta: StrikeItemMeta, traitNames: string[], attrs: Attributes, ops: Operation[]): StrikeTotals {
  const ranged = !!meta.range && meta.range !== 'null';
  const sel = strikeAttributes(ranged, traitNames);
  const attrMod = Math.max(...sel.attack.map((a) => attrs[a]));
  const attack = attrMod + (meta.attack_bonus ?? 0) + numericBonus(ops, 'ATTACK_ROLLS_BONUS');
  const { bonus, text } = splitDamageExtra(meta.damage?.extra);
  const str = attrs.STR;
  const strPart = sel.damage === 'full' ? str : sel.damage === 'half' ? (str > 0 ? Math.floor(str / 2) : str) : 0;
  return {
    ranged,
    attack,
    map: sel.agile ? [attack, attack - 4, attack - 8] : [attack, attack - 5, attack - 10],
    dice: Number(meta.damage?.dice ?? 1),
    die: meta.damage?.die ?? '',
    damageBonus: strPart + bonus + numericBonus(ops, 'ATTACK_DAMAGE_BONUS'),
    damageType: meta.damage?.damageType ?? '',
    effects: text,
  };
}

// ── Encounter XP (GM Core "Building Encounters") ──────────────────────────────

const XP_BY_LEVEL_DIFF: Record<number, number> = { [-4]: 10, [-3]: 15, [-2]: 20, [-1]: 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 };

export const ENCOUNTER_BUDGETS = [
  { label: 'Trivial', base: 40, perPlayer: 10 },
  { label: 'Low', base: 60, perPlayer: 15 },
  { label: 'Moderate', base: 80, perPlayer: 20 },
  { label: 'Severe', base: 120, perPlayer: 30 },
  { label: 'Extreme', base: 160, perPlayer: 40 },
] as const;

/** XP for one creature; null when it is more than 4 levels above the party (off the table). */
export function creatureXp(creatureLevel: number, partyLevel: number): number | null {
  const diff = creatureLevel - partyLevel;
  if (diff > 4) return null;
  if (diff < -4) return 0;
  return XP_BY_LEVEL_DIFF[diff];
}

export function encounterBudgets(partySize: number) {
  return ENCOUNTER_BUDGETS.map((b) => ({ label: b.label, xp: b.base + (partySize - 4) * b.perPlayer }));
}

/** Difficulty band for a total: the highest band whose budget the total reaches. */
export function difficultyFor(totalXp: number, partySize: number): string {
  const budgets = encounterBudgets(partySize);
  let label = 'Below Trivial';
  for (const b of budgets) if (totalXp >= b.xp) label = b.label;
  if (totalXp > budgets[budgets.length - 1].xp) label = 'Beyond Extreme';
  return label;
}

// ── Elite / weak adjustments (GM Core) ────────────────────────────────────────

export type Adjustment = 'ELITE' | 'WEAK';

export function adjustedLevel(level: number, adjustment: Adjustment): number {
  if (adjustment === 'ELITE') return level <= 0 ? level + 2 : level + 1;
  return level === 1 ? level - 2 : level - 1;
}

export function adjustmentHp(level: number, adjustment: Adjustment): number {
  if (adjustment === 'ELITE') {
    if (level <= 1) return 10;
    if (level <= 4) return 15;
    if (level <= 19) return 20;
    return 30;
  }
  if (level <= 2) return -10;
  if (level <= 5) return -15;
  if (level <= 20) return -20;
  return -30;
}
