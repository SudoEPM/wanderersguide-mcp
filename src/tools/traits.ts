import { wgFetch } from '../client.js';

interface Trait {
  id?: number;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

function formatTrait(t: Trait): string {
  const lines: string[] = [];
  if (t.name) lines.push(`**${t.name}**${t.id !== undefined ? ` (ID: ${t.id})` : ''}`);
  if (t.description) lines.push(`\n${t.description}`);
  return lines.join('\n');
}

export async function findTrait(args: {
  name?: string;
  id?: number | number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = args.id;
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = await wgFetch<Trait[]>('find-trait', body);

  if (!results || results.length === 0) {
    const term = args.name ?? (args.id !== undefined ? String(args.id) : null) ?? 'given criteria';
    return `No traits found matching "${term}".`;
  }

  return results.map(formatTrait).join('\n\n---\n\n');
}
