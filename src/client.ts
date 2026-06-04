const BASE_URL = 'https://api.wanderersguide.app/functions/v1';

export class WGError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'WGError';
  }
}

export async function wgFetch<T = unknown>(
  functionName: string,
  body: object
): Promise<T> {
  const apiKey = process.env.WG_API_KEY;
  if (!apiKey) throw new WGError('WG_API_KEY is not set');

  const url = `${BASE_URL}/${functionName}`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new WGError(`Network error calling ${functionName}: ${String(err)}`);
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') ?? '60';
    throw new WGError(`Rate limit reached. Retry after ${retryAfter} seconds.`, 429);
  }

  if (response.status === 403) {
    throw new WGError(
      'Access denied (403). For character endpoints, the character owner must grant access at: ' +
        'https://wanderersguide.app/account (Developer → API Clients → Character Authorization URL).',
      403
    );
  }

  let json: { status: string; data?: T; message?: string };
  try {
    json = await response.json();
  } catch {
    throw new WGError(`Failed to parse response from ${functionName} (HTTP ${response.status})`);
  }

  if (json.status === 'success') {
    return json.data as T;
  }

  if (json.status === 'fail') {
    const msg = (json.data as { message?: string })?.message ?? JSON.stringify(json.data);
    throw new WGError(`API error from ${functionName}: ${msg}`);
  }

  // status === 'error'
  throw new WGError(`API error from ${functionName}: ${json.message ?? 'unknown error'}`);
}
