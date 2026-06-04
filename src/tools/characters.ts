import { wgFetch, WGError } from '../client.js';

interface Character {
  id?: number;
  name?: string;
  level?: number;
  ancestry?: string;
  background?: string;
  class?: string;
  hp?: { current?: number; max?: number };
  abilities?: Record<string, number>;
  skills?: Record<string, number>;
  [key: string]: unknown;
}

function formatCharacter(c: Character): string {
  const lines: string[] = [];
  const header = [c.name, c.level !== undefined ? `Level ${c.level}` : null].filter(Boolean).join(' — ');
  if (header) lines.push(`**${header}**`);
  const identity = [c.ancestry, c.background, c.class].filter(Boolean).join(' / ');
  if (identity) lines.push(identity);
  if (c.hp) {
    const hpStr = [c.hp.current !== undefined ? `Current: ${c.hp.current}` : null, c.hp.max !== undefined ? `Max: ${c.hp.max}` : null].filter(Boolean).join(', ');
    if (hpStr) lines.push(`HP — ${hpStr}`);
  }
  if (c.abilities) {
    const ab = Object.entries(c.abilities).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' | ');
    lines.push(`Abilities: ${ab}`);
  }
  if (c.skills) {
    const sk = Object.entries(c.skills).map(([k, v]) => `${k} +${v}`).join(', ');
    lines.push(`Skills: ${sk}`);
  }
  return lines.join('\n');
}

export async function findCharacter(args: { id: number }): Promise<string> {
  try {
    const results = await wgFetch<Character[]>('find-character', { id: args.id });

    if (!results || results.length === 0) {
      return `No character found with ID ${args.id}.`;
    }

    return results.map(formatCharacter).join('\n\n---\n\n');
  } catch (err) {
    if (err instanceof WGError && err.status === 403) {
      return (
        `Character ID ${args.id} is not authorized. ` +
        `The character owner must grant access at: https://wanderersguide.app/account ` +
        `(Developer → API Clients → Character Authorization URL).`
      );
    }
    throw err;
  }
}
