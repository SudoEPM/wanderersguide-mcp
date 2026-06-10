import { randomUUID } from 'node:crypto';
import { wgFetch } from '../client.js';
import type { Creature } from './creatures.js';

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

function formatEncounter(e: Encounter): string {
  const lines: string[] = [];
  if (e.name) lines.push(`**${e.name}**${e.id !== undefined ? ` (ID: ${e.id})` : ''}`);
  if (e.campaign_id !== undefined) lines.push(`Campaign ID: ${e.campaign_id}`);
  const md = e.meta_data;
  if (md?.party_level !== undefined) lines.push(`Party: Level ${md.party_level}${md.party_size !== undefined ? `, ${md.party_size} players` : ''}`);
  if (md?.description) lines.push(`\n${md.description}`);
  const combatants = e.combatants?.list;
  if (combatants?.length) {
    lines.push(`\nCombatants:`);
    for (const c of combatants) lines.push(formatCombatant(c));
  }
  return lines.join('\n');
}

export async function findEncounter(args: {
  id?: number;
  campaign_id?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  const campaignId = args.campaign_id ?? (args.id === undefined && process.env.WG_CAMPAIGN_ID ? Number(process.env.WG_CAMPAIGN_ID) : undefined);
  if (campaignId !== undefined) body.campaign_id = campaignId;

  const results = await wgFetch<Encounter[]>('find-encounter', body);

  if (!results || results.length === 0) {
    return `No encounters found.`;
  }

  return results.map(formatEncounter).join('\n\n---\n\n');
}

type Adjustment = 'ELITE' | 'WEAK';

interface EnemyCreatureInput {
  id: number;
  adjustment?: Adjustment;
}

type CreatureRecord = Record<string, unknown>;

function hpAdjustment(level: number, elite: boolean): number {
  const sign = elite ? 1 : -1;
  if (level <= 4) return sign * 10;
  if (level <= 19) return sign * 15;
  return sign * 20;
}

function makeAdjOp(variable: string, value: string): CreatureRecord {
  return { id: randomUUID(), type: 'addBonusToValue', data: { variable, text: '', value, type: 'adj' } };
}

function applyAdjustment(base: CreatureRecord, adjustment: Adjustment): CreatureRecord {
  const elite = adjustment === 'ELITE';
  const sign = elite ? 1 : -1;
  const v = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  const level = (base.level as number) ?? 0;
  const label = elite ? 'elite' : 'weak';

  const adjOps: CreatureRecord[] = [
    { id: randomUUID(), type: 'adjValue', data: { variable: 'MAX_HEALTH_BONUS', value: hpAdjustment(level, elite) } },
    { id: randomUUID(), type: 'adjValue', data: { variable: 'AC_BONUS', value: sign * 2 } },
    makeAdjOp('ATTACK_ROLLS_BONUS', v(sign * 2)),
    makeAdjOp('ATTACK_DAMAGE_BONUS', v(sign * 2)),
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
    level: level + sign,
    details: { ...((base.details as object) ?? {}), adjustment },
    operations: [...((base.operations as unknown[]) ?? []), ...adjOps],
  };
}

// Custom enemies use the same Creature shape as database creatures.
// The caller is responsible for populating operations (stats), abilities_base,
// spells, inventory, traits, etc. exactly as the WG API would return them.
// A random id is assigned to avoid collisions with database IDs.
export type { Creature };

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

async function buildCombatants(
  enemy_creatures: EnemyCreatureInput[] = [],
  ally_character_ids: number[] = [],
  custom_enemies: Creature[] = [],
): Promise<CombatantEntry[]> {
  const list: CombatantEntry[] = [];

  if (enemy_creatures.length > 0) {
    const uniqueIds = [...new Set(enemy_creatures.map((e) => e.id))];
    const fetched = await wgFetch<unknown[]>('find-creature', { id: uniqueIds });
    const byId = new Map((fetched as { id?: number }[]).map((c) => [c.id, c]));

    for (const { id, adjustment } of enemy_creatures) {
      const base = byId.get(id) as CreatureRecord | undefined;
      if (!base) continue;
      const creature = adjustment ? applyAdjustment(base, adjustment) : base;
      list.push({ _id: randomUUID(), type: 'CREATURE', ally: false, creature });
    }
  }

  for (const charId of ally_character_ids) {
    list.push({ _id: randomUUID(), type: 'CHARACTER', ally: true, character: charId });
  }

  for (const custom of custom_enemies) {
    const creature: Creature = {
      id: Math.floor(Math.random() * 9_000_000) + 1_000_000,
      ...custom,
      operations: normalizeMultiValueOps(custom.operations ?? []),
    };
    list.push({ _id: randomUUID(), type: 'CREATURE', ally: false, creature });
  }

  return list;
}

export async function createEncounter(args: {
  campaign_id?: number;
  name: string;
  description?: string;
  party_level?: number;
  party_size?: number;
  enemy_creatures?: EnemyCreatureInput[];
  custom_enemies?: Creature[];
  ally_character_ids?: number[];
}): Promise<string> {
  const campaignId = args.campaign_id ?? (process.env.WG_CAMPAIGN_ID ? Number(process.env.WG_CAMPAIGN_ID) : undefined);
  if (campaignId === undefined) {
    return 'No campaign ID provided and WG_CAMPAIGN_ID environment variable is not set.';
  }

  const combatantList = await buildCombatants(args.enemy_creatures, args.ally_character_ids, args.custom_enemies);

  const meta_data: EncounterMetaData = {};
  if (args.description) meta_data.description = args.description;
  if (args.party_level !== undefined) meta_data.party_level = args.party_level;
  if (args.party_size !== undefined) meta_data.party_size = args.party_size;

  const body: Record<string, unknown> = {
    campaign_id: campaignId,
    name: args.name,
    combatants: { list: combatantList },
    meta_data,
    color: '#359fdf',
    icon: 'combat',
  };

  const result = await wgFetch<Encounter>('create-encounter', body);
  const name = result?.name ?? args.name;
  const id = result?.id;
  const summary: string[] = [`Encounter "${name}" created successfully${id !== undefined ? ` (ID: ${id})` : ''}.`];
  if (combatantList.length) summary.push(`${combatantList.length} combatant(s) added.`);
  return summary.join(' ');
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
