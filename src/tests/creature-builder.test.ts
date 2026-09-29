import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wgFetch } from '../client.js';
import { findCreature } from '../tools/creatures.js';
import {
  buildCreature,
  buildCustomCreature,
  decompileCreature,
  standardAbility,
  unknownTraitsNote,
  type Creature,
  type StatBlock,
} from '../tools/creature-builder.js';
import { createEncounter, encounterBudget, xpReport } from '../tools/encounters.js';
import { adjustedLevel, adjustmentHp, creatureXp, difficultyFor, splitDamageExtra } from '../creature-engine.js';
import { NO_MATCH, TIMEOUT } from './helpers.js';

describe('encounter rules (offline)', () => {
  test('creature XP by level difference', () => {
    assert.equal(creatureXp(5, 5), 40);
    assert.equal(creatureXp(2, 5), 15);
    assert.equal(creatureXp(9, 5), 160);
    assert.equal(creatureXp(10, 5), null);
    assert.equal(creatureXp(0, 5), 0);
  });

  test('difficulty bands scale with party size', () => {
    assert.equal(difficultyFor(120, 4), 'Severe');
    assert.equal(difficultyFor(119, 4), 'Moderate');
    assert.equal(difficultyFor(180, 6), 'Severe'); // 120 + 2 × 30
  });

  test('elite and weak adjustments follow GM Core', () => {
    assert.equal(adjustedLevel(5, 'ELITE'), 6);
    assert.equal(adjustedLevel(0, 'ELITE'), 2);
    assert.equal(adjustedLevel(1, 'WEAK'), -1);
    assert.equal(adjustmentHp(5, 'ELITE'), 20);
    assert.equal(adjustmentHp(3, 'WEAK'), -15);
  });

  test('damage extra splits the flat bonus from effects', () => {
    assert.deepEqual(splitDamageExtra('3 + Putrid Plague'), { bonus: 3, text: 'Putrid Plague' });
    assert.deepEqual(splitDamageExtra('-2 + 1d6 fire'), { bonus: -2, text: '1d6 fire' });
    assert.deepEqual(splitDamageExtra('Improved Grab'), { bonus: 0, text: 'Improved Grab' });
  });

  test('creatures more than 4 levels below the party are listed as worth no XP', () => {
    const report = xpReport([{ name: 'Rat', level: 0, ally: false }, { name: 'Thug', level: 5, ally: false }], 5);
    assert.match(report, /Rat — level 0 \(party -5\): 0 XP \(more than 4 levels below the party: not worth XP\)/);
    assert.match(report, /Total: 40 XP/);
  });

  test('non-combatants are reported apart from the combat XP that sets difficulty', async () => {
    const report = await encounterBudget({
      party_level: 5,
      creatures: [{ name: 'Samuel', level: 6, non_combatant: true }, { name: 'Thug', level: 5, count: 3 }],
    });
    assert.match(report, /Samuel \[non-combatant\] — level 6 \(party \+1\): 60 XP/);
    assert.match(report, /Combat XP: 120 XP → \*\*Severe\*\*/);
    assert.match(report, /Total including 1 non-combatant\(s\): 180 XP/);
    const plain = await encounterBudget({ party_level: 5, creatures: [{ name: 'Thug', level: 5, count: 3 }] });
    assert.match(plain, /Total: 120 XP → \*\*Severe\*\*/);
    assert.doesNotMatch(plain, /Combat XP/);
  });

  test('standard creature abilities match by name, legacy name, and with qualifiers', () => {
    assert.equal(standardAbility('Reactive Strike')?.key, 'ReactiveStrike');
    assert.equal(standardAbility('Attack of Opportunity')?.key, 'ReactiveStrike');
    assert.equal(standardAbility('Reactive Strike (Jaws Only)')?.key, 'ReactiveStrike');
    assert.equal(standardAbility('Fast Healing 5 (In Water)')?.key, 'FastHealing');
    assert.equal(standardAbility('Telepathy 100 feet')?.key, 'Telepathy');
    assert.equal(standardAbility('Negative Healing')?.key, 'NegativeHealing');
    assert.equal(standardAbility('Improved Push 10 feet')?.actions, 'FREE-ACTION');
    assert.equal(standardAbility('Bloodcurdling Screech'), null);
  });

  test('unknown trait note names the IDs and says nothing else needs fixing', () => {
    const note = unknownTraitsNote([2924]);
    assert.match(note, /trait ID\(s\) 2924/);
    assert.match(note, /no trait with this ID/);
    assert.match(note, /nothing else needs fixing/);
  });
});

describe('find_creature stat blocks', () => {
  test('matches published Monster Core numbers (Goblin Warrior)', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ name: 'Goblin Warrior' });
    assert.match(result, /AC 16; Fort \+5, Ref \+7, Will \+3/);
    assert.match(result, /HP 6\b/);
    assert.match(result, /Perception \+2/);
    assert.match(result, /Dogslicer \+7 .*Damage 1d6 slashing/);
    assert.match(result, /Ranged ◆ Shortbow \+7/);
  });

  test('includes Dex in AC and spell DCs from innate proficiency (Harpy, Dero Magister)', { timeout: TIMEOUT }, async () => {
    assert.match(await findCreature({ id: 10123 }), /AC 21;/);
    const dero = await findCreature({ name: 'Dero Magister' });
    assert.match(dero, /HP 65/); // MAX_HEALTH_BONUS 55 + CON 2 × level 5
    assert.match(dero, /Occult Innate Spells DC 24/);
    assert.match(dero, /\*\*3rd\*\* \(3 slots\) Blindness/);
  });
});

describe('creature builder', () => {
  test('decompile → build → decompile preserves every stat', { timeout: TIMEOUT * 4 }, async () => {
    const creatures = await wgFetch<Creature[]>('find-creature', { id: [10123, 10001, 10096] });
    const pick = (b: StatBlock) => JSON.stringify({
      ac: b.ac, hp: b.hp, saves: b.saves, perception: b.perception, skills: b.skills, attributes: b.attributes,
      strikes: b.strikes?.map((s) => [s.name, s.attack, s.damage, s.effects]),
      spells: b.spellcasting?.map((s) => [s.type, s.dc, s.attack, s.spells.map((sp) => sp.name)]),
      traits: b.traits?.length, senses: b.senses, immunities: b.immunities, speeds: b.speeds, abilities: b.abilities?.length,
    });
    for (const c of creatures) {
      const before = await decompileCreature(c);
      const { creature, warnings } = await buildCreature(before);
      assert.deepEqual(warnings, [], `${c.name}: unexpected warnings`);
      assert.equal(pick(await decompileCreature(creature)), pick(before), `${c.name}: stats changed in round trip`);
    }
  });

  test('builds a custom stat block with exact stats, real spells, and merged weapon', { timeout: TIMEOUT * 3 }, async () => {
    const { statBlock, warnings, creature } = await buildCustomCreature({
      name: 'Test Zealot', level: 6, perception: 13, ac: 23, hp: 95, saves: { fort: 13, ref: 14, will: 16 },
      attributes: { str: 2, dex: 3, con: 2, wis: 1, cha: 4 },
      traits: ['Human', 'Humanoid'], skills: { Religion: 14, 'Cult Lore': 12 },
      strikes: [{ name: 'Sickle', attack: 16, damage: '1d4+8 slashing plus 1d6 fire', traits: ['Agile', 'Finesse'] }],
      items: [{ name: 'Sickle' }],
      spellcasting: [{ type: 'innate', tradition: 'divine', dc: 24, spells: [{ name: 'Fireball', rank: 3, casts_per_day: 2 }, { name: 'Not A Real Spell', rank: 1 }] }],
    });
    assert.equal(statBlock.ac, 23);
    assert.equal(statBlock.hp, 95);
    assert.deepEqual(statBlock.saves, { fort: 13, ref: 14, will: 16 });
    assert.deepEqual(statBlock.skills, { Religion: 14, 'Cult Lore': 12 });
    assert.equal(statBlock.strikes?.length, 1, 'strike should merge into the carried Sickle');
    assert.equal(statBlock.strikes?.[0].attack, 16);
    assert.equal(statBlock.strikes?.[0].damage, '1d4+8 slashing');
    assert.equal(statBlock.spellcasting?.[0].dc, 24);
    assert.deepEqual(statBlock.spellcasting?.[0].spells.map((s) => s.name), ['Fireball']);
    assert.ok(warnings.some((w) => /Not A Real Spell/.test(w)));
    assert.ok((creature.operations ?? []).some((op) => op.type === 'giveSpell'), 'spells must be granted via giveSpell operations');
  });

  test('builds from a base creature with overrides', { timeout: TIMEOUT * 3 }, async () => {
    const { statBlock } = await buildCustomCreature({
      base_creature_id: 10123, name: 'Storm Harpy', level: 7, ac: 25, hp: 115,
      replace_strikes: true, strikes: [{ name: 'Storm Talon', attack: 18, damage: '2d8+6 slashing', traits: ['Agile', 'Finesse'] }],
      remove_abilities: ['Stench'],
    });
    assert.equal(statBlock.name, 'Storm Harpy');
    assert.equal(statBlock.ac, 25);
    assert.equal(statBlock.saves.fort, 9, 'unchanged stats keep the base values');
    assert.deepEqual(statBlock.strikes?.map((s) => s.name), ['Storm Talon']);
    assert.ok(!statBlock.abilities?.some((a) => a.name === 'Stench'));
    assert.ok(statBlock.speeds?.fly, 'base fly speed kept');
  });

  test('traits replace a base creature\'s traits; add_traits and remove_traits work with base_creature_name', { timeout: TIMEOUT * 3 }, async () => {
    const names = (b: StatBlock) => (b.traits ?? []).map((t) => (typeof t === 'object' ? t.name : t)).sort();
    const replaced = await buildCustomCreature({ base_creature_name: 'Captain Of The Guard', name: 'Orc Captain', traits: ['Orc', 'Humanoid'] });
    assert.deepEqual(names(replaced.statBlock), ['Humanoid', 'Orc']);
    const added = await buildCustomCreature({ base_creature_name: 'Captain Of The Guard', add_traits: ['Orc'], remove_traits: ['Human', 'lawful'] });
    const addedNames = names(added.statBlock);
    assert.ok(addedNames.includes('Orc') && addedNames.includes('Humanoid'));
    assert.ok(!addedNames.includes('Human') && !addedNames.includes('Lawful'), `unexpected traits ${addedNames}`);
  });

  test('copies abilities from a creature by name or ID, matching legacy names', { timeout: TIMEOUT * 3 }, async () => {
    // The Guard (legacy Bestiary) has "Attack of Opportunity", the pre-remaster Reactive Strike
    const { statBlock, warnings, creature } = await buildCustomCreature({
      base_creature_id: 10123, name: 'Guard Harpy',
      abilities: [{ name: 'Reactive Strike', from_creature: 'Guard' }, { name: 'Attack of Opportunity', from_creature: '12025' }],
    });
    assert.deepEqual(warnings, []);
    const copied = (creature.abilities_base ?? []).filter((a) => a.description === 'ReactiveStrike');
    assert.deepEqual(copied.map((a) => a.name), ['Reactive Strike', 'Attack of Opportunity']);
    assert.ok(copied.every((a) => a.actions === 'REACTION' && a.level === 5));
    assert.ok(statBlock.abilities?.some((a) => a.name === 'Reactive Strike'));
  });

  test('from_creature explains a missing ability by listing what the creature has', { timeout: TIMEOUT * 2 }, async () => {
    const { warnings } = await buildCustomCreature({ base_creature_id: 10123, abilities: [{ name: 'Breath Weapon', from_creature: 'Guard' }] });
    assert.ok(warnings.some((w) => /"Breath Weapon" not found on creature "Guard" \(it has: Attack of Opportunity\)/.test(w)), warnings.join('\n'));
    const missing = await buildCustomCreature({ base_creature_id: 10123, abilities: [{ name: 'Grab', from_creature: NO_MATCH }] });
    assert.ok(missing.warnings.some((w) => /not found; ability skipped/.test(w)));
  });

  test('existing: true builds standard creature abilities as glossary entries', { timeout: TIMEOUT * 2 }, async () => {
    const { warnings, creature } = await buildCustomCreature({
      base_creature_id: 10123, replace_abilities: true,
      abilities: [{ name: 'Reactive Strike', existing: true }, { name: 'Telepathy 100 feet', existing: true }],
    });
    assert.deepEqual(warnings, []);
    const [rs, telepathy] = creature.abilities_base ?? [];
    assert.deepEqual([rs.name, rs.actions, rs.description, rs.type], ['Reactive Strike', 'REACTION', 'ReactiveStrike', 'action']);
    assert.deepEqual(telepathy.traits, [1492, 1504, 1448]);
  });
});

describe('encounter planning', () => {
  test('encounter_budget totals XP and difficulty', { timeout: TIMEOUT }, async () => {
    const result = await encounterBudget({ party_level: 5, creatures: [{ id: 10123, adjustment: 'ELITE' }, { name: 'Custom Boss', level: 6 }] });
    assert.match(result, /Total: 120 XP → \*\*Severe\*\*/);
  });

  test('dry run exports an importable encounter JSON', { timeout: TIMEOUT * 3 }, async () => {
    const path = join(tmpdir(), `wg-mcp-encounter-${Date.now()}.json`);
    try {
      const result = await createEncounter({
        name: 'Dry Run Test', party_level: 5, dry_run: true, export_file: path,
        enemy_creatures: [{ id: 10096, count: 3 }],
        custom_enemies: [{ base_creature_id: 10123, name: 'Reskinned Harpy' }],
      });
      assert.match(result, /Dry run/);
      assert.match(result, /Total: \d+ XP/);
      const json = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(json.version, 1);
      assert.equal(json.encounter.name, 'Dry Run Test');
      assert.equal(json.encounter.combatants.list.length, 4);
      for (const c of json.encounter.combatants.list) {
        assert.deepEqual(Object.keys(c).sort(), ['_id', 'ally', 'creature', 'type']);
        assert.ok(Array.isArray(c.creature.operations));
      }
    } finally {
      await rm(path, { force: true });
    }
  });

  test('dry run explains removed unknown trait IDs (Drow Rogue, trait 2924)', { timeout: TIMEOUT * 2 }, async () => {
    const result = await createEncounter({ name: 'Drow Test', party_level: 3, dry_run: true, enemy_creatures: [{ id: 10463 }] });
    assert.match(result, /Drow Rogue \(ID 10463\): removed trait ID\(s\) 2924: Wanderer's Guide has no trait with this ID/);
  });
});

describe('creature benchmarks', () => {
  test('bands are ordered and a preview compares against them', { timeout: TIMEOUT * 3 }, async () => {
    const { getBenchmarks } = await import('../tools/benchmarks.js');
    const b = await getBenchmarks(5);
    assert.ok(b.sample > 20, 'expected many official level-5 creatures');
    for (const band of Object.values(b.bands)) {
      assert.ok(band!.low <= band!.moderate && band!.moderate <= band!.high && band!.high <= band!.extreme);
    }
    const { previewCustomCreature } = await import('../tools/encounters.js');
    const preview = await previewCustomCreature({ name: 'Glass Cannon', level: 5, perception: 12, ac: 15, hp: 30, saves: { fort: 8, ref: 15, will: 9 } });
    assert.match(preview, /Compared with \d+ official level-5 creatures: AC 15 below low, HP 30 below low/);
  });
});

describe('editing encounter combatants', () => {
  test('add and remove combatants, and update_encounter keeps other meta fields', { timeout: TIMEOUT * 6 }, async () => {
    const { addCombatants, removeCombatants, updateEncounter, findEncounter, deleteEncounter } = await import('../tools/encounters.js');
    const { getCurrentUserId } = await import('../tools/campaigns.js');
    const [campaign] = await wgFetch<{ id: number }[]>('find-campaign', { user_id: await getCurrentUserId() });
    if (!campaign) return;
    const created = await createEncounter({ campaign_id: campaign.id, name: `Edit Test ${Date.now()}`, party_level: 5, description: 'keep me', enemy_creatures: [{ id: 10096, count: 2 }] });
    const id = Number(created.match(/\(ID: (\d+)\)/)![1]);
    try {
      const preview = await addCombatants({ encounter_id: id, enemy_creatures: [{ id: 10123 }], dry_run: true });
      assert.match(preview, /Dry run: 1 combatant\(s\) would be added/);
      assert.match(preview, /3\. \[enemy\] Harpy Level 5/);
      assert.doesNotMatch(await findEncounter({ id }), /3\. /, 'dry run must not save');
      const added = await addCombatants({ encounter_id: id, enemy_creatures: [{ id: 10123 }] });
      assert.match(added, /3\. \[enemy\] Harpy Level 5/);
      const removed = await removeCombatants({ encounter_id: id, positions: [1, 2] });
      assert.match(removed, /Total: 40 XP/);
      await addCombatants({ encounter_id: id, enemy_creatures: [{ id: 10123, non_combatant: true }] });
      await updateEncounter({ id, party_size: 5 });
      const found = await findEncounter({ id });
      assert.match(found, /keep me/);
      assert.match(found, /Party: Level 5, 5 players/);
      assert.match(found, /1\. \[enemy\] Harpy Level 5/);
      assert.match(found, /2\. \[non-combatant\] Harpy Level 5/);
      assert.match(found, /Combat XP: 40 XP/);
      assert.match(found, /Total including 1 non-combatant\(s\): 80 XP/);
    } finally {
      await deleteEncounter({ id });
    }
  });
});
