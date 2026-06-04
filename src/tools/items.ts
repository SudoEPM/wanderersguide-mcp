import { wgFetch } from '../client.js';

interface Item {
  id?: number;
  name?: string;
  level?: number;
  price?: string | number;
  bulk?: string | number;
  traits?: string[];
  category?: string;
  group?: string;
  description?: string;
  [key: string]: unknown;
}

function formatItem(item: Item): string {
  const lines: string[] = [];
  const header = [item.name, item.level !== undefined ? `Level ${item.level}` : null]
    .filter(Boolean)
    .join(' ');
  if (header) lines.push(`**${header}**`);
  if (item.category) lines.push(`Category: ${item.category}${item.group ? ` (${item.group})` : ''}`);
  if (item.traits?.length) lines.push(`Traits: ${item.traits.join(', ')}`);
  if (item.price !== undefined) lines.push(`Price: ${item.price}`);
  if (item.bulk !== undefined) lines.push(`Bulk: ${item.bulk}`);
  if (item.description) lines.push(`\n${item.description}`);
  return lines.join('\n');
}

export async function findItem(args: {
  name?: string;
  id?: number | number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = args.id;

  const results = await wgFetch<Item[]>('find-item', body);

  if (!results || results.length === 0) {
    const term = args.name ?? String(args.id) ?? 'given criteria';
    return `No items found matching "${term}".`;
  }

  return results.map(formatItem).join('\n\n---\n\n');
}
