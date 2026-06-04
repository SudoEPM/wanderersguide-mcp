import { wgFetch, WGError } from '../client.js';

interface CharacterDetails {
  ancestry?: { name?: string };
  background?: { name?: string };
  class?: { name?: string };
  info?: {
    appearance?: string;
    age?: string;
    height?: string;
    weight?: string;
    gender?: string;
    pronouns?: string;
  };
}

interface Character {
  id?: number;
  name?: string;
  level?: number;
  experience?: number;
  hp_current?: number;
  hp_temp?: number;
  hero_points?: number;
  stamina_current?: number;
  resolve_current?: number;
  campaign_id?: number;
  details?: CharacterDetails;
  [key: string]: unknown;
}

function formatCharacter(c: Character): string {
  const lines: string[] = [];

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

  const hpParts: string[] = [];
  if (c.hp_current !== undefined) hpParts.push(`HP: ${c.hp_current}`);
  if (c.hp_temp) hpParts.push(`Temp HP: ${c.hp_temp}`);
  if (c.hero_points !== undefined) hpParts.push(`Hero Points: ${c.hero_points}`);
  if (hpParts.length) lines.push(hpParts.join(' | '));

  if (c.experience !== undefined) lines.push(`XP: ${c.experience}`);

  const info = c.details?.info;
  if (info) {
    const infoStr = [
      info.gender ? `${info.gender}${info.pronouns ? ` (${info.pronouns})` : ''}` : null,
      info.age ? `Age: ${info.age}` : null,
      info.height ? `Height: ${info.height}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    if (infoStr) lines.push(infoStr);
  }

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
  if (args.campaign_id !== undefined) body.campaign_id = args.campaign_id;

  try {
    const raw = await wgFetch<Character | Character[]>('find-character', body);
    const results: Character[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

    if (results.length === 0) {
      const term = args.id !== undefined ? `ID ${args.id}` : args.campaign_id !== undefined ? `campaign ${args.campaign_id}` : 'given criteria';
      return `No character found matching ${term}.`;
    }

    return results.map(formatCharacter).join('\n\n---\n\n');
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
