import { wgFetch, toArray } from '../client.js';
import { runAdvancedSearch } from './search.js';
import { computeStrike, computeTotals, NO_LEVEL, type Operation, type StrikeItemMeta } from '../creature-engine.js';
import type { StatBlock } from './creature-builder.js';

/**
 * Creature stat benchmarks per level, measured from the official creatures in the database
 * (the same data find_creature shows). Bands are percentiles of those creatures:
 * low = 25th, moderate = median, high = 75th, extreme = 95th — the same shape as
 * GM Core's "Building Creatures" tables, derived from real stat blocks instead of copied.
 */

const STATS = [
  ['ac', 'AC'],
  ['hp', 'HP'],
  ['perception', 'Perception'],
  ['best_save', 'Best save'],
  ['worst_save', 'Worst save'],
  ['strike_attack', 'Strike attack (best)'],
  ['strike_damage', 'Strike damage (avg, best)'],
  ['spell_dc', 'Spell DC (casters)'],
  ['best_skill', 'Best skill'],
] as const;

type StatKey = (typeof STATS)[number][0];

export interface Benchmarks {
  level: number;
  sample: number;
  bands: Partial<Record<StatKey, { low: number; moderate: number; high: number; extreme: number; n: number }>>;
}

interface CreatureRow {
  level?: number;
  operations?: Operation[];
  inventory?: { items?: { item: { traits?: number[]; meta_data?: StrikeItemMeta } }[] };
}

const cache = new Map<number, Benchmarks>();
const traitNames = new Map<number, string>();

function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}

function averageDamage(dice: number, die: string, bonus: number): number {
  const size = parseInt(die.replace('d', ''), 10) || 0;
  return dice * (size + 1) / 2 + bonus;
}

export async function getBenchmarks(level: number): Promise<Benchmarks> {
  const cached = cache.get(level);
  if (cached) return cached;

  const rows = (await runAdvancedSearch({ type: 'creature', level_min: level, level_max: level })) as CreatureRow[];
  const creatures = rows.filter((r) => r.level === level && r.level !== NO_LEVEL);

  // Weapon trait names decide finesse/agile/ranged attack math
  const traitIds = creatures.flatMap((c) => (c.inventory?.items ?? []).flatMap((i) => i.item.traits ?? []));
  const missing = [...new Set(traitIds)].filter((id) => !traitNames.has(id));
  if (missing.length) {
    for (const t of toArray(await wgFetch<{ id: number; name: string } | { id: number; name: string }[]>('find-trait', { id: missing }))) {
      traitNames.set(t.id, t.name.toLowerCase());
    }
  }

  const values: Record<StatKey, number[]> = Object.fromEntries(STATS.map(([k]) => [k, []])) as unknown as Record<StatKey, number[]>;
  for (const c of creatures) {
    const ops = c.operations ?? [];
    const t = computeTotals(level, ops);
    values.ac.push(t.ac);
    values.hp.push(t.hp);
    values.perception.push(t.perception);
    values.best_save.push(Math.max(t.fort, t.reflex, t.will));
    values.worst_save.push(Math.min(t.fort, t.reflex, t.will));
    if (t.spellDc !== null) values.spell_dc.push(t.spellDc);
    if (t.skills.length) values.best_skill.push(Math.max(...t.skills.map((s) => s.total)));

    const strikes = (c.inventory?.items ?? [])
      .filter((i) => i.item.meta_data?.damage?.die)
      .map((i) => computeStrike(i.item.meta_data!, (i.item.traits ?? []).map((id) => traitNames.get(id) ?? ''), t.attributes, ops));
    if (strikes.length) {
      const best = strikes.reduce((a, b) => (b.attack > a.attack ? b : a));
      values.strike_attack.push(best.attack);
      values.strike_damage.push(Math.round(averageDamage(best.dice, best.die, best.damageBonus)));
    }
  }

  const bands: Benchmarks['bands'] = {};
  for (const [key] of STATS) {
    const sorted = [...values[key]].sort((a, b) => a - b);
    if (sorted.length < 3) continue;
    bands[key] = {
      low: percentile(sorted, 0.25),
      moderate: percentile(sorted, 0.5),
      high: percentile(sorted, 0.75),
      extreme: percentile(sorted, 0.95),
      n: sorted.length,
    };
  }
  const result = { level, sample: creatures.length, bands };
  cache.set(level, result);
  return result;
}

export async function creatureBenchmarks(args: { level: number }): Promise<string> {
  const b = await getBenchmarks(args.level);
  if (b.sample < 3) return `Too few official level-${args.level} creatures (${b.sample}) to compute benchmarks.`;
  const lines = [
    `Stat benchmarks for level ${b.level} creatures, measured from ${b.sample} official stat blocks (low = 25th percentile, moderate = median, high = 75th, extreme = 95th):`,
    '| Stat | Low | Moderate | High | Extreme |',
    '|---|---|---|---|---|',
  ];
  for (const [key, label] of STATS) {
    const band = b.bands[key];
    if (!band) continue;
    const sign = key === 'ac' || key === 'hp' || key === 'strike_damage' || key === 'spell_dc' ? '' : '+';
    const fmt = (n: number) => (sign && n >= 0 ? `+${n}` : `${n}`);
    lines.push(`| ${label}${key === 'spell_dc' ? ` (n=${band.n})` : ''} | ${fmt(band.low)} | ${fmt(band.moderate)} | ${fmt(band.high)} | ${fmt(band.extreme)} |`);
  }
  lines.push(
    '',
    'Guidance: most creatures sit at moderate with one or two high stats and a low one that fits their concept (a brute: high HP and attack, low AC or Will). ' +
      'Reserve extreme values for a signature strength or a solo boss. Spell DCs and strike attacks around the high band are typical for casters and brutes respectively.',
  );
  return lines.join('\n');
}

/** One-line comparison of a stat block against its level's benchmarks, for preview_custom_creature. */
export async function compareToBenchmarks(block: StatBlock): Promise<string | null> {
  if (block.level === NO_LEVEL) return null;
  const b = await getBenchmarks(block.level);
  if (b.sample < 3) return null;

  const band = (key: StatKey, value: number | undefined) => {
    const t = b.bands[key];
    if (value === undefined || !t) return null;
    const label =
      value > t.extreme ? 'above extreme' : value >= t.extreme ? 'extreme' : value >= t.high ? 'high' : value >= t.moderate ? 'moderate' : value >= t.low ? 'low' : 'below low';
    return `${label}`;
  };
  const strikes = (block.strikes ?? []).map((s) => {
    const m = s.damage.match(/^(\d+)d(\d+)([+-]\d+)?/);
    return { attack: s.attack, damage: m ? averageDamage(Number(m[1]), `d${m[2]}`, Number(m[3] ?? 0)) : undefined };
  });
  const best = strikes.length ? strikes.reduce((a, c) => (c.attack > a.attack ? c : a)) : undefined;
  const saves = [block.saves.fort, block.saves.ref, block.saves.will];
  const dc = block.spellcasting?.find((s) => s.dc !== undefined)?.dc;

  const parts = [
    `AC ${block.ac} ${band('ac', block.ac)}`,
    `HP ${block.hp} ${band('hp', block.hp)}`,
    `Perception ${band('perception', block.perception)}`,
    `best save ${band('best_save', Math.max(...saves))}`,
    `worst save ${band('worst_save', Math.min(...saves))}`,
    best ? `strike +${best.attack} ${band('strike_attack', best.attack)}` : null,
    best?.damage !== undefined ? `damage ~${Math.round(best.damage)} ${band('strike_damage', Math.round(best.damage))}` : null,
    dc !== undefined ? `spell DC ${dc} ${band('spell_dc', dc)}` : null,
  ].filter(Boolean);
  return `Compared with ${b.sample} official level-${block.level} creatures: ${parts.join(', ')}. (See creature_benchmarks for the numbers.)`;
}
