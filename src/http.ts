import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * MyHora sits behind Cloudflare, which fingerprints the HTTP client rather than the
 * request. Node's built-in fetch is answered with an interstitial challenge on every
 * request, while curl — a perfectly ordinary HTTP client — is served the page normally
 * from the same address at the same moment.
 *
 * So requests go through curl when it is available. Nothing here defeats a challenge:
 * no challenge script is executed, no TLS fingerprint is impersonated and no address is
 * rotated. It is a plain GET from a standard tool. If curl is missing, fetch is used and
 * the caller learns about the failure through the usual error path.
 *
 * Requests are also spaced out, because these are small volunteer-run sites and this
 * collector has no reason to be in a hurry.
 */
const MIN_INTERVAL_MS = 1_500;
let lastRequestAt = 0;

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
}

async function pace(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

let curlAvailable: boolean | null = null;

async function hasCurl(): Promise<boolean> {
  if (curlAvailable !== null) return curlAvailable;
  try {
    await execFileAsync('curl', ['--version'], { timeout: 10_000 });
    curlAvailable = true;
  } catch {
    curlAvailable = false;
  }
  return curlAvailable;
}

async function viaCurl(url: string, timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync(
    'curl',
    [
      '--silent',
      '--show-error',
      '--location',
      '--compressed',
      '--fail',
      '--max-time',
      String(Math.ceil(timeoutMs / 1000)),
      '--user-agent',
      USER_AGENT,
      '--header',
      'Accept-Language: th,en;q=0.8',
      url,
    ],
    { timeout: timeoutMs + 5_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
  );
  return stdout;
}

/** An HTTP error response, as opposed to a network failure or timeout. */
export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * A 403 or 404 will not change in the next few seconds, and retrying one only hits a
 * volunteer-run site again for nothing. Timeouts, 5xx, 408 and 429 are worth another try.
 */
export function isRetryable(error: unknown): boolean {
  const status =
    error instanceof HttpStatusError
      ? error.status
      : Number(/returned error: (\d{3})/.exec(error instanceof Error ? error.message : '')?.[1]);
  if (!Number.isFinite(status) || status === 0) return true;
  return status >= 500 || status === 408 || status === 429;
}

async function viaFetch(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'th,en;q=0.8' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new HttpStatusError(`GET ${url} returned ${response.status} ${response.statusText}`, response.status);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Successful responses, kept for the life of the process. Several sources serve every year
 * from one URL — BOT, Google and MyHora's feed — so collecting two years would otherwise
 * download each of them twice.
 */
const responses = new Map<string, string>();

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const cached = responses.get(url);
  if (cached !== undefined) return cached;

  const { timeoutMs = 30_000, retries = 2 } = options;
  const useCurl = await hasCurl();
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await pace();
    try {
      const body = useCurl ? await viaCurl(url, timeoutMs) : await viaFetch(url, timeoutMs);
      responses.set(url, body);
      return body;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) break;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }

  const detail = lastError instanceof Error ? lastError.message.trim() : String(lastError);
  throw new Error(`Failed to fetch ${url}: ${detail}`);
}
