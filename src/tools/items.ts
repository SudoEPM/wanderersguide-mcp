import { wgFetch, toArray } from '../client.js';
import { suggestByName } from './search.js';

interface Trait {
  id: number;
  name: string;
}

interface Price {
  pp?: number;
  gp?: number;
  sp?: number;
  cp?: number;
}

interface Item {
  id?: number;
  name?: string;
  level?: number;
  rarity?: string;
  price?: Price | string | number;
  bulk?: string | number;
  traits?: (string | number)[];
  group?: string;
  hands?: string;
  size?: string;
  usage?: string;
  craft_requirements?: string;
  description?: string;
  [key: string]: unknown;
}

function formatPrice(price: Price | string | number | undefined): string | null {
  if (price === undefined || price === null) return null;
  if (typeof price === 'string') return price || null;
  if (typeof price === 'number') return String(price);
  const parts: string[] = [];
  if (price.pp) parts.push(`${price.pp} pp`);
  if (price.gp) parts.push(`${price.gp} gp`);
  if (price.sp) parts.push(`${price.sp} sp`);
  if (price.cp) parts.push(`${price.cp} cp`);
  return parts.length ? parts.join(', ') : null;
}

function formatItem(item: Item): string {
  const lines: string[] = [];
  const header = [item.name, item.level !== undefined ? `Level ${item.level}` : null]
    .filter(Boolean)
    .join(' ');
  if (header) lines.push(`**${header}**`);
  const groupParts = [item.group, item.size && item.size !== 'MEDIUM' ? item.size : null].filter(Boolean);
  if (groupParts.length) lines.push(`Group: ${groupParts.join(' / ')}`);
  if (item.usage) lines.push(`Usage: ${item.usage}${item.hands ? ` (${item.hands})` : ''}`);
  if (item.rarity && item.rarity !== 'COMMON') lines.push(`Rarity: ${item.rarity}`);
  if (item.traits?.length) lines.push(`Traits: ${item.traits.join(', ')}`);
  const priceStr = formatPrice(item.price as Price | string | number | undefined);
  if (priceStr) lines.push(`Price: ${priceStr}`);
  if (item.bulk !== undefined) lines.push(`Bulk: ${item.bulk}`);
  if (item.description) lines.push(`\n${item.description}`);
  return lines.join('\n');
}

async function resolveTraits(items: Item[]): Promise<void> {
  const ids = new Set<number>();
  for (const item of items) {
    for (const t of item.traits ?? []) {
      if (typeof t === 'number') ids.add(t);
    }
  }
  if (ids.size === 0) return;

  const traits = await wgFetch<Trait[]>('find-trait', { id: [...ids] });
  const byId = new Map(traits.map((t) => [t.id, t.name]));

  for (const item of items) {
    item.traits = (item.traits ?? []).map((t) =>
      typeof t === 'number' ? (byId.get(t) ?? `trait:${t}`) : t
    );
  }
}

export async function findItem(args: {
  name?: string;
  id?: number | number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = Array.isArray(args.id) ? args.id : [args.id];
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = toArray(await wgFetch<Item | Item[]>('find-item', body));

  if (results.length === 0) {
    const term = args.name ?? String(args.id) ?? 'given criteria';
    return `No items found matching "${term}".` + (args.name ? await suggestByName('item', args.name) : '');
  }

  await resolveTraits(results);
  return results.map(formatItem).join('\n\n---\n\n');
}
