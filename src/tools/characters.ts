import { wgFetch, WGError } from '../client.js';

interface ContentEntity {
  id?: number;
  name?: string;
  rarity?: string;
  description?: string;
  content_source_id?: number;
  version?: string;
  [key: string]: unknown;
}

interface CharacterInfo {
  appearance?: string;
  age?: string;
  height?: string;
  weight?: string;
  gender?: string;
  pronouns?: string;
  biography?: string;
}

interface CharacterCondition {
  id?: number;
  name?: string;
  value?: number;
  [key: string]: unknown;
}

interface CharacterDetails {
  ancestry?: ContentEntity;
  background?: ContentEntity;
  class?: ContentEntity;
  info?: CharacterInfo;
  conditions?: CharacterCondition[];
  languages?: string[];
  [key: string]: unknown;
}

interface InventoryItem {
  id?: string;
  item?: {
    id?: number;
    name?: string;
    level?: number;
    quantity?: number;
    [key: string]: unknown;
  };
  is_equipped?: boolean;
  is_invested?: boolean;
  container_contents?: InventoryItem[];
  [key: string]: unknown;
}

interface CharacterInventory {
  coins?: {
    cp?: number;
    sp?: number;
    gp?: number;
    pp?: number;
  };
  items?: InventoryItem[];
  [key: string]: unknown;
}

interface SpellEntry {
  spell_id?: number;
  rank?: number;
  source?: string;
  [key: string]: unknown;
}

interface SpellSlot {
  rank?: number;
  current?: number;
  max?: number;
  [key: string]: unknown;
}

interface CharacterSpells {
  slots?: SpellSlot[];
  list?: SpellEntry[];
  focus_point_current?: number;
  innate_casts?: unknown[];
  [key: string]: unknown;
}

type ProfType = 'U' | 'T' | 'E' | 'M' | 'L';
interface ProfEntry { total: number; type: ProfType }

interface CalculatedStats {
  hp_max?: number;
  stamina_max?: number;
  resolve_max?: number;
  ac?: number;
  profs?: Record<string, ProfEntry>;
  [key: string]: unknown;
}

interface CharacterMetaData {
  calculated_stats?: CalculatedStats;
  reset_hp?: boolean;
  given_item_ids?: number[];
  [key: string]: unknown;
}

interface CharacterOptions {
  custom_operations?: boolean;
  auto_detect_prerequisites?: boolean;
  [key: string]: unknown;
}

interface CharacterVariants {
  free_archetype?: boolean;
  dual_class?: boolean;
  [key: string]: unknown;
}

interface CharacterContentSources {
  enabled?: number[];
  [key: string]: unknown;
}

interface Character {
  id?: number;
  created_at?: string;
  user_id?: string;
  campaign_id?: number;
  name?: string;
  level?: number;
  experience?: number;
  hero_points?: number;
  hp_current?: number;
  hp_temp?: number;
  stamina_current?: number;
  resolve_current?: number;
  details?: CharacterDetails;
  inventory?: CharacterInventory;
  spells?: CharacterSpells;
  notes?: { pages?: unknown[] };
  meta_data?: CharacterMetaData;
  options?: CharacterOptions;
  variants?: CharacterVariants;
  content_sources?: CharacterContentSources;
  custom_operations?: unknown[];
  operation_data?: { selections?: Record<string, string> };
  companions?: unknown;
  roll_history?: unknown;
  [key: string]: unknown;
}

const SKILL_LABEL: Record<string, string> = {
  SKILL_ACROBATICS: 'Acrobatics', SKILL_ARCANA: 'Arcana', SKILL_ATHLETICS: 'Athletics',
  SKILL_CRAFTING: 'Crafting', SKILL_DECEPTION: 'Deception', SKILL_DIPLOMACY: 'Diplomacy',
  SKILL_INTIMIDATION: 'Intimidation', SKILL_MEDICINE: 'Medicine', SKILL_NATURE: 'Nature',
  SKILL_OCCULTISM: 'Occultism', SKILL_PERFORMANCE: 'Performance', SKILL_RELIGION: 'Religion',
  SKILL_SOCIETY: 'Society', SKILL_STEALTH: 'Stealth', SKILL_SURVIVAL: 'Survival',
  SKILL_THIEVERY: 'Thievery',
};

function sign(n: number): string { return n >= 0 ? `+${n}` : `${n}`; }

function profLabel(p: ProfEntry): string { return `${sign(p.total)} (${p.type})`; }

function extractSpeed(c: Character): number | null {
  type Op = { type: string; data?: { variable?: string; value?: number } };
  for (const src of [c.details?.class, c.details?.ancestry, c.details?.background]) {
    for (const op of ((src?.operations ?? []) as Op[]).slice().reverse()) {
      if (op.type === 'setValue' && op.data?.variable === 'SPEED' && op.data.value !== undefined) {
        return op.data.value;
      }
    }
  }
  return null;
}

function formatCoins(coins: CharacterInventory['coins']): string | null {
  if (!coins) return null;
  const parts: string[] = [];
  if (coins.pp) parts.push(`${coins.pp}pp`);
  if (coins.gp) parts.push(`${coins.gp}gp`);
  if (coins.sp) parts.push(`${coins.sp}sp`);
  if (coins.cp) parts.push(`${coins.cp}cp`);
  return parts.length ? parts.join(' ') : null;
}

function formatCharacter(c: Character, spellNames: Map<number, string> = new Map(), langNames: Map<number, string> = new Map()): string {
  const lines: string[] = [];
  const stats = c.meta_data?.calculated_stats;

  const header = [c.name, c.level !== undefined ? `Level ${c.level}` : null]
    .filter(Boolean)
    .join(' — ');
  if (header) lines.push(`**${header}**`);

  const identity = [
    c.details?.ancestry?.name,
    c.details?.background?.name,
    c.details?.class?.name,
  ]
    .filter(Boolean)
    .join(' / ');
  if (identity) lines.push(identity);

  const profs = stats?.profs ?? {};

  // HP / AC / Perception / Speed / Hero Points
  const hpMax = stats?.hp_max;
  const hpStr = `HP: ${c.hp_current ?? '?'}${hpMax !== undefined ? `/${hpMax}` : ''}${c.hp_temp ? ` (+${c.hp_temp} temp)` : ''}`;
  const acStr = stats?.ac !== undefined ? `AC: ${stats.ac}` : null;
  const percStr = profs.PERCEPTION ? `Perc: ${profLabel(profs.PERCEPTION)}` : null;
  const speed = extractSpeed(c);
  const speedStr = speed !== null ? `Speed: ${speed} ft` : null;
  const hpLine = [hpStr, acStr, percStr, speedStr].filter(Boolean).join(' | ');
  if (hpLine) lines.push(hpLine);

  if (c.hero_points !== undefined) lines.push(`Hero Points: ${c.hero_points}`);

  // Stamina / Resolve (only shown when the variant is active)
  if (stats?.stamina_max && stats.stamina_max > 0) {
    lines.push(`Stamina: ${c.stamina_current ?? 0}/${stats.stamina_max} | Resolve: ${c.resolve_current ?? 0}/${stats.resolve_max ?? 0}`);
  }

  // Saving throws
  const fort = profs.SAVE_FORT;
  const ref = profs.SAVE_REFLEX;
  const will = profs.SAVE_WILL;
  if (fort || ref || will) {
    const saveStr = [
      fort ? `Fort: ${profLabel(fort)}` : null,
      ref  ? `Ref: ${profLabel(ref)}`  : null,
      will ? `Will: ${profLabel(will)}` : null,
    ].filter(Boolean).join(' | ');
    lines.push(saveStr);
  }

  // Spell stats (only if trained+)
  const spellAtk = profs.SPELL_ATTACK;
  const spellDc = profs.SPELL_DC;
  const classDc = profs.CLASS_DC;
  const spellLine = [
    spellAtk && spellAtk.type !== 'U' ? `Spell Atk: ${sign(spellAtk.total)}` : null,
    spellDc  && spellDc.type  !== 'U' ? `Spell DC: ${10 + spellDc.total}` : null,
    classDc  && classDc.type  !== 'U' ? `Class DC: ${10 + classDc.total}` : null,
  ].filter(Boolean).join(' | ');
  if (spellLine) lines.push(spellLine);

  // Trained+ skills (skip Untrained)
  const skillEntries = Object.entries(profs)
    .filter(([k, v]) => (k.startsWith('SKILL_')) && v.type !== 'U')
    .sort(([, a], [, b]) => b.total - a.total);
  if (skillEntries.length) {
    const skillParts = skillEntries.map(([k, v]) => {
      const label = SKILL_LABEL[k] ?? (k.startsWith('SKILL_LORE_')
        ? k.slice('SKILL_LORE_'.length).split('_').map(w => w[0] + w.slice(1).toLowerCase()).join(' ') + ' Lore'
        : k.slice(6));
      return `${label} ${sign(v.total)} (${v.type})`;
    });
    lines.push(`Skills: ${skillParts.join(', ')}`);
  }

  // Languages — collected from giveLanguage operations across all sources
  type LangOp = { type: string; data?: { languageId?: number } };
  const langIds = new Set<number>();
  for (const src of [c.details?.ancestry, c.details?.background, c.details?.class]) {
    for (const op of ((src?.operations ?? []) as LangOp[])) {
      if (op.type === 'giveLanguage' && op.data?.languageId) langIds.add(op.data.languageId);
    }
  }
  for (const op of ((c.custom_operations ?? []) as LangOp[])) {
    if (op.type === 'giveLanguage' && op.data?.languageId) langIds.add(op.data.languageId);
  }
  if (langIds.size > 0) {
    const resolved = [...langIds].map((id) => langNames.get(id) ?? `lang:${id}`);
    lines.push(`Languages: ${resolved.join(', ')}`);
  }

  if (c.experience !== undefined) lines.push(`XP: ${c.experience}`);

  // Conditions
  const conditions = c.details?.conditions;
  if (conditions?.length) {
    const condStr = conditions
      .map((cond) => cond.value !== undefined ? `${cond.name} ${cond.value}` : cond.name)
      .filter(Boolean)
      .join(', ');
    if (condStr) lines.push(`Conditions: ${condStr}`);
  }

  // Spells
  const spells = c.spells;
  if (spells?.list?.length) {
    // Count available slots per rank
    const slotsAvail = new Map<number, number>();
    for (const slot of spells.slots ?? []) {
      if (!slot.exhausted) {
        const r = slot.rank ?? 0;
        slotsAvail.set(r, (slotsAvail.get(r) ?? 0) + 1);
      }
    }
    // Group spells by rank
    const byRank = new Map<number, string[]>();
    for (const s of spells.list) {
      if (!s.spell_id) continue;
      const name = spellNames.get(s.spell_id) ?? `spell:${s.spell_id}`;
      const rank = s.rank ?? 0;
      if (!byRank.has(rank)) byRank.set(rank, []);
      byRank.get(rank)!.push(name);
    }
    const focusCurrent = spells.focus_point_current;
    if (focusCurrent !== undefined) lines.push(`Focus Points: ${focusCurrent}`);
    for (const [rank, names] of [...byRank.entries()].sort(([a], [b]) => a - b)) {
      const label = rank === 0 ? 'Cantrips' : `Rank ${rank}`;
      const avail = slotsAvail.get(rank);
      const slotStr = rank > 0 && avail !== undefined ? ` [${avail} slots]` : '';
      lines.push(`  ${label}${slotStr}: ${names.join(', ')}`);
    }
    // Innate casts
    for (const ic of spells.innate_casts ?? []) {
      const s = ic as { spell_id?: number; rank?: number; casts_max?: number; casts_current?: number };
      if (!s.spell_id) continue;
      const name = spellNames.get(s.spell_id) ?? `spell:${s.spell_id}`;
      const used = s.casts_current ?? 0;
      const max = s.casts_max ?? 1;
      lines.push(`  Innate: ${name} (${used}/${max} used)`);
    }
  }

  // Inventory
  const coins = formatCoins(c.inventory?.coins);
  if (coins) lines.push(`Coins: ${coins}`);
  const items = c.inventory?.items ?? [];
  if (items.length) {
    lines.push(`Inventory:`);
    for (const entry of items) {
      const item = entry.item;
      if (!item?.name) continue;
      const qty = (item.meta_data as { quantity?: number } | undefined)?.quantity ?? 1;
      const lvl = item.level ? ` (L${item.level})` : '';
      const tags: string[] = [];
      if (entry.is_equipped) tags.push('equipped');
      if (entry.is_invested) tags.push('invested');
      const tagStr = tags.length ? ` [${tags.join(', ')}]` : '';
      lines.push(`  - ${qty > 1 ? `${qty}× ` : ''}${item.name}${lvl}${tagStr}`);
      for (const inner of entry.container_contents ?? []) {
        const iitem = inner.item;
        if (!iitem?.name) continue;
        const iqty = (iitem.meta_data as { quantity?: number } | undefined)?.quantity ?? 1;
        const ilvl = iitem.level ? ` (L${iitem.level})` : '';
        lines.push(`      • ${iqty > 1 ? `${iqty}× ` : ''}${iitem.name}${ilvl}`);
      }
    }
  }

  // Personal info
  const info = c.details?.info;
  if (info) {
    const infoStr = [
      info.gender ? `${info.gender}${info.pronouns ? ` (${info.pronouns})` : ''}` : null,
      info.age ? `Age: ${info.age}` : null,
      info.height ? `Height: ${info.height}` : null,
      info.weight ? `Weight: ${info.weight}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    if (infoStr) lines.push(infoStr);
  }

  // Variant rules
  const variants: string[] = [];
  if (c.variants?.free_archetype) variants.push('Free Archetype');
  if (c.variants?.dual_class) variants.push('Dual Class');
  if (variants.length) lines.push(`Variants: ${variants.join(', ')}`);

  return lines.join('\n');
}

export async function findCharacter(args: {
  id?: number | number[];
  user_id?: string;
  campaign_id?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.user_id) body.user_id = args.user_id;
  const campaignId = args.campaign_id ?? (process.env.WG_CAMPAIGN_ID ? Number(process.env.WG_CAMPAIGN_ID) : undefined);
  if (campaignId !== undefined) body.campaign_id = campaignId;

  try {
    const raw = await wgFetch<Character | Character[]>('find-character', body);
    const results: Character[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

    if (results.length === 0) {
      const term = args.id !== undefined ? `ID ${args.id}` : campaignId !== undefined ? `campaign ${campaignId}` : 'given criteria';
      return `No character found matching ${term}.`;
    }

    // Collect spell IDs and language IDs across all characters for batch resolution
    const allSpellIds = new Set<number>();
    const allLangIds = new Set<number>();
    type LangOp = { type: string; data?: { languageId?: number } };

    for (const c of results) {
      for (const s of c.spells?.list ?? []) {
        if (s.spell_id) allSpellIds.add(s.spell_id);
      }
      for (const s of c.spells?.innate_casts ?? []) {
        const sc = s as { spell_id?: number };
        if (sc.spell_id) allSpellIds.add(sc.spell_id);
      }
      for (const src of [c.details?.ancestry, c.details?.background, c.details?.class]) {
        for (const op of ((src?.operations ?? []) as LangOp[])) {
          if (op.type === 'giveLanguage' && op.data?.languageId) allLangIds.add(op.data.languageId);
        }
      }
      for (const op of ((c.custom_operations ?? []) as LangOp[])) {
        if (op.type === 'giveLanguage' && op.data?.languageId) allLangIds.add(op.data.languageId);
      }
    }

    const [spellNames, langNames] = await Promise.all([
      allSpellIds.size > 0
        ? wgFetch<{ id?: number; name?: string }[]>('find-spell', { id: [...allSpellIds] })
            .then((r) => new Map((r ?? []).filter((s) => s.id && s.name).map((s) => [s.id!, s.name!])))
        : Promise.resolve(new Map<number, string>()),
      allLangIds.size > 0
        ? wgFetch<{ id?: number; name?: string }[]>('find-language', { id: [...allLangIds] })
            .then((r) => new Map((r ?? []).filter((l) => l.id && l.name).map((l) => [l.id!, l.name!])))
        : Promise.resolve(new Map<number, string>()),
    ]);

    return results.map((c) => formatCharacter(c, spellNames, langNames)).join('\n\n---\n\n');
  } catch (err) {
    if (err instanceof WGError && err.status === 403) {
      const idStr = args.id !== undefined ? ` ID ${args.id}` : '';
      return (
        `Character${idStr} is not authorized. ` +
        `The character owner must grant access at: https://wanderersguide.app/account ` +
        `(Developer → API Clients → Character Authorization URL).`
      );
    }
    throw err;
  }
}
