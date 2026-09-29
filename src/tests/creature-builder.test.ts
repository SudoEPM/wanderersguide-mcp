import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wgFetch } from '../client.js';
import { findCreature } from '../tools/creatures.js';
import { buildCreature, buildCustomCreature, decompileCreature, type Creature, type StatBlock } from '../tools/creature-builder.js';
import { createEncounter, encounterBudget } from '../tools/encounters.js';
import { adjustedLevel, adjustmentHp, creatureXp, difficultyFor, splitDamageExtra } from '../creature-engine.js';
import { TIMEOUT } from './helpers.js';

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
});
