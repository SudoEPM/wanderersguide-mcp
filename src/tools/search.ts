import { wgFetch } from '../client.js';

interface SearchResult {
  id?: number;
  name?: string;
  type?: string;
  level?: number;
  description?: string;
  [key: string]: unknown;
}

export async function searchContent(args: {
  query: string;
  type?: string;
  limit?: number;
}): Promise<string> {
  const body: Record<string, unknown> = { query: args.query };
  if (args.type) body.type = args.type;
  if (args.limit !== undefined) body.limit = args.limit;

  const results = await wgFetch<SearchResult[]>('search-data', body);

  if (!results || results.length === 0) {
    return `No results found for "${args.query}".`;
  }

  const lines = results.map((r) => {
    const parts: string[] = [];
    if (r.name) parts.push(r.name);
    if (r.type) parts.push(`[${r.type}]`);
    if (r.level !== undefined) parts.push(`Level ${r.level}`);
    if (r.id !== undefined) parts.push(`(ID: ${r.id})`);
    return parts.join(' ');
  });

  return `Search results for "${args.query}" (${results.length} found):\n${lines.join('\n')}`;
}
