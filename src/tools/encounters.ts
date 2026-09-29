import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { wgFetch, toArray } from '../client.js';
import type { Creature } from './creatures.js';
import {
  adjustedLevel,
  adjustmentHp,
  creatureXp,
  difficultyFor,
  encounterBudgets,
  NO_LEVEL,
  type Adjustment,
} from '../creature-engine.js';
import {
  buildCustomCreature,
  decompileCreature,
  formatStatBlock,
  isStatBlockInput,
  validateStatBlock,
  type BasedStatBlock,
  type Creature as BuilderCreature,
  type StatBlock,
} from './creature-builder.js';

interface EncounterMetaData {
  description?: string;
  party_level?: number;
  party_size?: number;
}

interface CombatantEntry {
  _id: string;
  type: 'CREATURE' | 'CHARACTER';
  ally: boolean;
  creature?: unknown;
  character?: number;
}

interface Encounter {
  id?: number;
  name?: string;
  campaign_id?: number;
  meta_data?: EncounterMetaData;
  combatants?: { list?: CombatantEntry[] };
  [key: string]: unknown;
}

// ── XP report ─────────────────────────────────────────────────────────────────

interface XpEntry {
  name: string;
  level: number;
  ally: boolean;
}

/** XP breakdown and difficulty for an encounter, per GM Core's Building Encounters rules. */
export function xpReport(entries: XpEntry[], partyLevel?: number, partySize = 4): string {
  if (partyLevel === undefined) return 'XP: set party_level to calculate the XP budget.';

  const enemies = entries.filter((e) => !e.ally);
  const groups = new Map<string, { entry: XpEntry; count: number }>();
  for (const e of enemies) {
    const key = `${e.name}|${e.level}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { entry: e, count: 1 });
  }

  const lines: string[] = [];
  const warnings: string[] = [];
  let total = 0;
  for (const { entry, count } of groups.values()) {
    const level = entry.level === NO_LEVEL ? partyLevel : entry.level;
    const xp = creatureXp(level, partyLevel);
    if (xp === null) {
      warnings.push(`${entry.name} (level ${level}) is more than 4 levels above the party: off the XP table and likely to cause a TPK.`);
      lines.push(`- ${entry.name}${count > 1 ? ` ×${count}` : ''} — level ${level}: off the XP table`);
      continue;
    }
    total += xp * count;
    const diff = level - partyLevel;
    lines.push(`- ${entry.name}${count > 1 ? ` ×${count}` : ''} — level ${level} (party ${diff >= 0 ? '+' : ''}${diff}): ${xp} XP${count > 1 ? ` each, ${xp * count} total` : ''}`);
  }

  const budgets = encounterBudgets(partySize).map((b) => `${b.label} ${b.xp}`).join(' | ');
  const allies = entries.filter((e) => e.ally).length;
  return [
    `XP for ${partySize} level-${partyLevel} characters:`,
    ...lines,
    `Total: ${total} XP → **${difficultyFor(total, partySize)}**`,
    `Budgets: ${budgets}`,
    ...(allies ? [`(${allies} allied combatant(s) not counted)`] : []),
    ...warnings.map((w) => `⚠ ${w}`),
  ].join('\n');
}

function xpEntryOf(c: CombatantEntry): XpEntry | null {
  if (c.type !== 'CREATURE') return null;
  const cr = c.creature as { name?: string; level?: number } | undefined;
  return { name: cr?.name ?? 'Unknown', level: cr?.level ?? 0, ally: c.ally };
}

// ── find_encounter ────────────────────────────────────────────────────────────

function formatCombatant(c: CombatantEntry): string {
  if (c.type === 'CHARACTER') {
    return `  - [ally] Character ID ${c.character}`;
  }
  const cr = c.creature as { name?: string; level?: number } | undefined;
  const parts = [
    c.ally ? '[ally]' : '[enemy]',
    cr?.name ?? 'Unknown',
    cr?.level !== undefined ? `Level ${cr.level}` : null,
  ].filter(Boolean);
  return `  - ${parts.join(' ')}`;
}

async function formatEncounter(e: Encounter, detailed: boolean): Promise<string> {
  const lines: string[] = [];
  if (e.name) lines.push(`**${e.name}**${e.id !== undefined ? ` (ID: ${e.id})` : ''}`);
  if (e.campaign_id !== undefined) lines.push(`Campaign ID: ${e.campaign_id}`);
  const md = e.meta_data;
  if (md?.party_level !== undefined) lines.push(`Party: Level ${md.party_level}${md.party_size !== undefined ? `, ${md.party_size} players` : ''}`);
  if (md?.description) lines.push(`\n${md.description}`);
  const combatants = e.combatants?.list ?? [];
  if (combatants.length) {
    lines.push(`\nCombatants:`);
    for (const c of combatants) lines.push(formatCombatant(c));
    const xpEntries = combatants.map(xpEntryOf).filter((x): x is XpEntry => x !== null);
    if (md?.party_level !== undefined && xpEntries.length) lines.push(`\n${xpReport(xpEntries, md.party_level, md.party_size ?? 4)}`);
  }
  if (detailed) {
    const seen = new Set<string>();
    for (const c of combatants) {
      if (c.type !== 'CREATURE' || !c.creature) continue;
      const cr = c.creature as BuilderCreature;
      const key = `${cr.name}|${cr.level}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`\n${formatStatBlock(await decompileCreature(cr))}`);
    }
  }
  return lines.join('\n');
}

export async function findEncounter(args: {
  id?: number;
  campaign_id?: number;
  detailed?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = Array.isArray(args.id) ? args.id : [args.id];
  const campaignId = args.campaign_id ?? (args.id === undefined && process.env.WG_CAMPAIGN_ID ? Number(process.env.WG_CAMPAIGN_ID) : undefined);
  if (campaignId !== undefined) body.campaign_id = campaignId;

  const results = toArray(await wgFetch<Encounter | Encounter[]>('find-encounter', body));

  if (results.length === 0) {
    return `No encounters found.`;
  }

  const formatted = await Promise.all(results.map((e) => formatEncounter(e, args.detailed ?? false)));
  return formatted.join('\n\n---\n\n');
}

// ── Building combatants ───────────────────────────────────────────────────────

interface EnemyCreatureInput {
  id: number;
  adjustment?: Adjustment;
  count?: number;
}

type CustomEnemyInput = (StatBlock | BasedStatBlock | Creature) & { count?: number };

type CreatureRecord = Record<string, unknown>;

function makeAdjOp(variable: string, value: string): CreatureRecord {
  return { id: randomUUID(), type: 'addBonusToValue', data: { variable, text: '', value, type: 'adj' } };
}

/** GM Core elite/weak adjustment: ±2 to AC, attacks, damage, DCs, saves, Perception, skills; level and HP by table. */
function applyAdjustment(base: CreatureRecord, adjustment: Adjustment): CreatureRecord {
  const elite = adjustment === 'ELITE';
  const sign = elite ? 1 : -1;
  const v = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  const level = (base.level as number) ?? 0;
  const label = elite ? 'elite' : 'weak';

  const adjOps: CreatureRecord[] = [
    { id: randomUUID(), type: 'adjValue', data: { variable: 'MAX_HEALTH_BONUS', value: adjustmentHp(level, adjustment) } },
    { id: randomUUID(), type: 'adjValue', data: { variable: 'AC_BONUS', value: sign * 2 } },
    makeAdjOp('ATTACK_ROLLS_BONUS', v(sign * 2)),
    makeAdjOp('ATTACK_DAMAGE_BONUS', v(sign * 2)),
    makeAdjOp('SPELL_ATTACK', v(sign * 2)),
    makeAdjOp('SPELL_DC', v(sign * 2)),
    makeAdjOp('SAVE_FORT', v(sign * 2)),
    makeAdjOp('SAVE_REFLEX', v(sign * 2)),
    makeAdjOp('SAVE_WILL', v(sign * 2)),
    makeAdjOp('PERCEPTION', v(sign * 2)),
    ...['ACROBATICS', 'ARCANA', 'ATHLETICS', 'CRAFTING', 'DECEPTION', 'DIPLOMACY',
      'INTIMIDATION', 'LORE____', 'MEDICINE', 'NATURE', 'OCCULTISM', 'PERFORMANCE',
      'RELIGION', 'SOCIETY', 'STEALTH', 'SURVIVAL', 'THIEVERY',
    ].map((s) => makeAdjOp(`SKILL_${s}`, v(sign * 2))),
  ];

  return {
    ...base,
    name: `${base.name} (${label})`,
    level: level === NO_LEVEL ? level : adjustedLevel(level, adjustment),
    details: { ...((base.details as object) ?? {}), adjustment },
    operations: [...((base.operations as unknown[]) ?? []), ...adjOps],
  };
}

// Raw custom creatures (with `operations`) are passed through in WG's native format.
// Per the WG operations docs, list-str variables (IMMUNITIES, WEAKNESSES, RESISTANCES,
// SENSES, LANGUAGES, etc.) treat each adjValue as appending exactly ONE entry.
// Rather than maintaining an incomplete variable name set, we detect multi-entry strings
// by content: any adjValue whose string value contains a comma before a letter (i.e. a
// new entry, not a name/amount separator like "silver, 5") gets split into one op per entry.
//
// WG entry formats:
//   Simple:      "paralyzed, "    (trailing ", " for entries without amounts)
//   With amount: "silver, 5"      (comma between name and number within one entry)
//
// Callers may pass "silver 5" (space) or "silver, 5" (already correct) — both work.

function formatMultiValueEntry(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  // Already "name, number" format — keep as-is
  if (/,\s*\d+$/.test(s)) return s;
  // "name number" → "name, number"
  const m = s.match(/^(.+?)\s+(\d+)$/);
  if (m) return `${m[1]}, ${m[2]}`;
  // Simple token — WG expects trailing ", "
  return `${s}, `;
}

function normalizeMultiValueOps(ops: import('./creatures.js').Operation[]): import('./creatures.js').Operation[] {
  const result: import('./creatures.js').Operation[] = [];
  for (const op of ops) {
    const val = op.data?.value;
    if (op.type === 'adjValue' && typeof val === 'string') {
      // Split on commas followed by a letter — those are list-entry separators.
      // Commas before a digit ("silver, 5") are name/amount separators and must NOT split.
      const entries = val.split(/,\s*(?=[a-zA-Z])/).map((s) => formatMultiValueEntry(s)).filter(Boolean);
      if (entries.length > 1) {
        for (const entry of entries) {
          result.push({ ...op, id: randomUUID(), data: { ...op.data, value: entry } });
        }
        continue;
      }
    }
    result.push(op);
  }
  return result;
}

interface BuiltCombatants {
  list: CombatantEntry[];
  warnings: string[];
  customBlocks: StatBlock[];
}

async function buildCombatants(
  enemy_creatures: EnemyCreatureInput[] = [],
  ally_character_ids: number[] = [],
  custom_enemies: CustomEnemyInput[] = [],
): Promise<BuiltCombatants> {
  const list: CombatantEntry[] = [];
  const warnings: string[] = [];
  const customBlocks: StatBlock[] = [];

  if (enemy_creatures.length > 0) {
    const uniqueIds = [...new Set(enemy_creatures.map((e) => e.id))];
    const fetched = toArray(await wgFetch<CreatureRecord | CreatureRecord[]>('find-creature', { id: uniqueIds }));
    const byId = new Map(fetched.map((c) => [c.id as number, c]));

    for (const { id, adjustment, count = 1 } of enemy_creatures) {
      const base = byId.get(id);
      if (!base) {
        warnings.push(`Creature ID ${id} not found; skipped.`);
        continue;
      }
      const creature = adjustment ? applyAdjustment(base, adjustment) : base;
      for (let i = 0; i < count; i++) list.push({ _id: randomUUID(), type: 'CREATURE', ally: false, creature });
    }
  }

  for (const charId of ally_character_ids) {
    list.push({ _id: randomUUID(), type: 'CHARACTER', ally: true, character: charId });
  }

  for (const { count = 1, ...custom } of custom_enemies) {
    let creature: CreatureRecord;
    if (isStatBlockInput(custom)) {
      const missing = 'base_creature_id' in custom || 'base_creature_name' in custom ? [] : validateStatBlock(custom as StatBlock);
      if (missing.length) {
        warnings.push(...missing);
        continue;
      }
      const built = await buildCustomCreature(custom);
      warnings.push(...built.warnings.map((w) => `${built.creature.name}: ${w}`));
      customBlocks.push(built.statBlock);
      creature = built.creature;
    } else {
      // Raw WG creature (advanced): pass through with list-entry normalization
      const raw = custom as Creature;
      creature = {
        id: Math.floor(Math.random() * 9_000_000) + 1_000_000,
        ...raw,
        operations: normalizeMultiValueOps(raw.operations ?? []),
      };
    }
    for (let i = 0; i < count; i++) list.push({ _id: randomUUID(), type: 'CREATURE', ally: false, creature });
  }

  return { list, warnings, customBlocks };
}

// ── create / update / delete ──────────────────────────────────────────────────

export async function createEncounter(args: {
  campaign_id?: number;
  name: string;
  description?: string;
  party_level?: number;
  party_size?: number;
  enemy_creatures?: EnemyCreatureInput[];
  custom_enemies?: CustomEnemyInput[];
  ally_character_ids?: number[];
  export_file?: string;
  dry_run?: boolean;
}): Promise<string> {
  const campaignId = args.campaign_id ?? (process.env.WG_CAMPAIGN_ID ? Number(process.env.WG_CAMPAIGN_ID) : undefined);
  if (campaignId === undefined && !args.dry_run) {
    return 'No campaign ID provided and WG_CAMPAIGN_ID environment variable is not set. Pass campaign_id, or use dry_run with export_file to produce an importable JSON file instead.';
  }

  const { list: combatantList, warnings, customBlocks } = await buildCombatants(args.enemy_creatures, args.ally_character_ids, args.custom_enemies);

  const meta_data: EncounterMetaData = {};
  if (args.description) meta_data.description = args.description;
  if (args.party_level !== undefined) meta_data.party_level = args.party_level;
  if (args.party_size !== undefined) meta_data.party_size = args.party_size;

  const body: Record<string, unknown> = {
    ...(campaignId !== undefined ? { campaign_id: campaignId } : {}),
    name: args.name,
    combatants: { list: combatantList },
    meta_data,
    color: '#359fdf',
    icon: 'combat',
  };

  const summary: string[] = [];
  let encounterId: number | undefined;
  if (args.dry_run) {
    summary.push(`Dry run: encounter "${args.name}" was not saved. ${combatantList.length} combatant(s) prepared.`);
  } else {
    const result = await wgFetch<Encounter>('create-encounter', body);
    encounterId = result?.id;
    summary.push(`Encounter "${result?.name ?? args.name}" created successfully${encounterId !== undefined ? ` (ID: ${encounterId})` : ''}.` +
      (combatantList.length ? ` ${combatantList.length} combatant(s) added.` : ''));
  }

  if (args.export_file) {
    const path = resolve(args.export_file);
    const encounter = { ...(encounterId !== undefined ? { id: encounterId } : {}), ...body };
    await writeFile(path, JSON.stringify({ version: 1, encounter }, null, 2), 'utf8');
    summary.push(`Exported to ${path} — import it in Wanderer's Guide from an encounter's settings (Import overrides that encounter).`);
  }

  const xpEntries = combatantList.map(xpEntryOf).filter((x): x is XpEntry => x !== null);
  if (xpEntries.length) summary.push('', xpReport(xpEntries, args.party_level, args.party_size ?? 4));
  if (warnings.length) summary.push('', 'Warnings:', ...warnings.map((w) => `- ${w}`));
  for (const block of customBlocks) summary.push('', 'Custom creature as saved:', formatStatBlock(block));
  return summary.join('\n');
}

export async function updateEncounter(args: {
  id: number;
  name?: string;
  description?: string;
  party_level?: number;
  party_size?: number;
  campaign_id?: number;
  icon?: string;
  color?: string;
}): Promise<string> {
  // The API uses create-encounter with an id as upsert. Only pass meta_data
  // fields that are being changed to avoid overwriting existing values.
  const body: Record<string, unknown> = { id: args.id };
  if (args.name) body.name = args.name;
  const campaignId = args.campaign_id ?? (process.env.WG_CAMPAIGN_ID ? Number(process.env.WG_CAMPAIGN_ID) : undefined);
  if (campaignId !== undefined) body.campaign_id = campaignId;
  if (args.icon) body.icon = args.icon;
  if (args.color) body.color = args.color;

  const meta: EncounterMetaData = {};
  let hasMeta = false;
  if (args.description !== undefined) { meta.description = args.description; hasMeta = true; }
  if (args.party_level !== undefined) { meta.party_level = args.party_level; hasMeta = true; }
  if (args.party_size !== undefined) { meta.party_size = args.party_size; hasMeta = true; }
  if (hasMeta) body.meta_data = meta;

  await wgFetch<unknown>('create-encounter', body);
  return `Encounter ID ${args.id} updated successfully.`;
}

export async function deleteEncounter(args: { id: number }): Promise<string> {
  // The API uses delete-content with type 'encounter' for deletion.
  await wgFetch<unknown>('delete-content', { id: args.id, type: 'encounter' });
  return `Encounter ID ${args.id} deleted successfully.`;
}

// ── Planning tools ────────────────────────────────────────────────────────────

export async function encounterBudget(args: {
  party_level: number;
  party_size?: number;
  creatures?: { id?: number; name?: string; level?: number; adjustment?: Adjustment; count?: number }[];
}): Promise<string> {
  const partySize = args.party_size ?? 4;
  const entries: XpEntry[] = [];
  for (const c of args.creatures ?? []) {
    let name = c.name ?? 'Creature';
    let level = c.level;
    if (level === undefined && (c.id !== undefined || c.name)) {
      const [found] = toArray(await wgFetch<CreatureRecord | CreatureRecord[]>('find-creature', c.id !== undefined ? { id: c.id } : { name: c.name }));
      if (!found) return `Creature ${c.id ?? `"${c.name}"`} not found.`;
      name = String(found.name);
      level = Number(found.level);
    }
    if (level === undefined) return `Creature "${name}" needs a level, id, or exact name.`;
    if (c.adjustment) {
      level = adjustedLevel(level, c.adjustment);
      name = `${name} (${c.adjustment.toLowerCase()})`;
    }
    for (let i = 0; i < (c.count ?? 1); i++) entries.push({ name, level, ally: false });
  }
  if (!entries.length) {
    const budgets = encounterBudgets(partySize).map((b) => `${b.label} ${b.xp}`).join(' | ');
    return `XP budgets for ${partySize} level-${args.party_level} characters: ${budgets}\n` +
      `Creature XP by level relative to the party: -4: 10, -3: 15, -2: 20, -1: 30, +0: 40, +1: 60, +2: 80, +3: 120, +4: 160.`;
  }
  return xpReport(entries, args.party_level, partySize);
}

export async function previewCustomCreature(args: StatBlock | BasedStatBlock): Promise<string> {
  if (!('base_creature_id' in args) && !('base_creature_name' in args)) {
    const missing = validateStatBlock(args as StatBlock);
    if (missing.length) return missing.join('\n');
  }
  const built = await buildCustomCreature(args);
  const parts = [formatStatBlock(built.statBlock)];
  if (built.warnings.length) parts.push('', 'Warnings:', ...built.warnings.map((w) => `- ${w}`));
  return parts.join('\n');
}
