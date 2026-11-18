// One place for outbound requests: a timeout, failures normalised into a
// ServiceError whose `kind` says what went wrong, and good manners towards
// the server (few requests at once, backing off when asked to).

export class ServiceError extends Error {
  constructor(message, { kind, status = null, retryAfterMs = null, cause } = {}) {
    super(message, { cause });
    this.name = 'ServiceError';
    this.kind = kind; // 'network' | 'timeout' | 'http' | 'busy' | 'malformed' | 'empty'
    this.status = status;
    this.retryAfterMs = retryAfterMs; // how long the server asked us to wait, if it said
  }
}

const SLOW_DOWN = new Set([429, 503]);

function retryAfter(response) {
  const seconds = Number(response.headers?.get?.('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export async function getJson(url, { timeoutMs = 6000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } catch (cause) {
      const kind = controller.signal.aborted ? 'timeout' : 'network';
      throw new ServiceError(`Request failed (${kind})`, { kind, cause });
    }
    if (!response.ok) {
      throw new ServiceError(`Request failed (HTTP ${response.status})`, {
        kind: SLOW_DOWN.has(response.status) ? 'busy' : 'http',
        status: response.status,
        retryAfterMs: retryAfter(response),
      });
    }
    try {
      return await response.json();
    } catch (cause) {
      const kind = controller.signal.aborted ? 'timeout' : 'malformed';
      throw new ServiceError(`Unreadable response (${kind})`, { kind, cause });
    }
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wraps a `getJson` so a page that wants ten things at once does not ask for
// them all at once: at most `concurrency` requests are in flight, and one the
// server turns away as "too many" (429, 503) is asked again after the pause
// the server names, or a growing one of our own, before giving up.
export function polite(
  request,
  { concurrency = 2, retries = 2, baseDelayMs = 700, maxDelayMs = 4000, wait = sleep } = {},
) {
  let inFlight = 0;
  const waiting = [];

  const enter = () =>
    inFlight < concurrency
      ? void (inFlight += 1)
      : new Promise((resolve) => waiting.push(resolve)); // the slot is handed over on leave
  const leave = () => {
    const next = waiting.shift();
    if (next) next();
    else inFlight -= 1;
  };

  return async function politeGetJson(url, options) {
    await enter();
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await request(url, options);
        } catch (err) {
          const again = err instanceof ServiceError && err.kind === 'busy' && attempt < retries;
          if (!again) throw err;
          await wait(Math.min(maxDelayMs, err.retryAfterMs ?? baseDelayMs * 2 ** attempt));
        }
      }
    } finally {
      leave();
    }
  };
}
