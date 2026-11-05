// platform_client.js: bloomHR's machine-to-machine calls to the Figbloom platform API (client credentials against the
// customers pool's Cognito /oauth2/token, then a bearer token on the API). Two clients use it:
//
//   the console   PLATFORM_CONSOLE_CLIENT_ID / PLATFORM_CONSOLE_CLIENT_SECRET, scope platform/console
//                 (platform_school_groups_routes.js, platform_school_hr_routes.js)
//   HR itself     PLATFORM_CLIENT_ID / PLATFORM_CLIENT_SECRET, scope platform/tenants.write: the "hr" service client
//                 (platform_events_routes.js: links an HR company to its platform tenant, sends hr.* events)
//
// Both share PLATFORM_API_URL and PLATFORM_TOKEN_URL. Each client keeps its own token until a minute before it
// expires, and asks for one token at a time. The client secret and the token are never logged nor sent back.
//
// Errors are PlatformError { status, code, message }: the platform's 4xx pass through (except 401/403: the client's
// own credential was refused, so after one retry with a new token that is a 502); anything else (unreachable, a
// timeout, 5xx, not JSON) is a 502 platform_unavailable; missing settings are a 503 platform_not_connected.

export const PLATFORM_TIMEOUT_MS = 8 * 1000;
const TOKEN_MARGIN_MS = 60 * 1000; // a token is renewed a minute before it expires
const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

export class PlatformError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const read = (name) => String(process.env[name] || "").trim();

/**
 * A client for one set of credentials.
 *   clientIdEnv, clientSecretEnv  the names of the settings holding them
 *   scope                         the OAuth scope asked for
 *   tag                           the log prefix ("[platform/school-groups]")
 *   who                           who signs in, in messages ("The console", "Figbloom HR")
 *   notConnected                  the 503's message when a setting is missing
 */
export function createPlatformClient({ clientIdEnv, clientSecretEnv, scope, tag, who, notConnected }) {
  const unavailable = (message = "The Figbloom platform didn't answer. Try again.") => new PlatformError(502, "platform_unavailable", message);

  function settings() {
    const apiUrl = read("PLATFORM_API_URL").replace(/\/+$/, "");
    const tokenUrl = read("PLATFORM_TOKEN_URL");
    const clientId = read(clientIdEnv);
    const clientSecret = read(clientSecretEnv);
    if (!apiUrl || !tokenUrl || !clientId || !clientSecret) throw new PlatformError(503, "platform_not_connected", notConnected);
    return { apiUrl, tokenUrl, clientId, clientSecret };
  }

  let cached = null; // { key, token, expiresAt }
  let pending = null; // { key, promise }: one token request at a time

  function resetToken() {
    cached = null;
    pending = null;
  }

  async function requestToken(s, timeoutMs) {
    let response;
    let payload;
    try {
      response = await fetch(s.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      payload = await response.json().catch(() => null);
    } catch (err) {
      console.error(tag, "token request", err?.name === "TimeoutError" ? "timed out" : `failed (${err?.name || "error"})`);
      throw unavailable(`${who} couldn't sign in to the Figbloom platform. Try again.`);
    }
    if (!response.ok || typeof payload?.access_token !== "string" || !payload.access_token) {
      // the status only: the answer may echo the client
      console.error(tag, "token request refused", response.status);
      throw unavailable(`${who} couldn't sign in to the Figbloom platform. Check its settings.`);
    }
    const seconds = Number(payload.expires_in) > 0 ? Number(payload.expires_in) : 3600;
    return { token: payload.access_token, expiresAt: Date.now() + seconds * 1000 };
  }

  async function token(s, timeoutMs) {
    const key = `${s.tokenUrl}|${s.clientId}`;
    if (cached && cached.key === key && Date.now() < cached.expiresAt - TOKEN_MARGIN_MS) return cached.token;
    if (!pending || pending.key !== key) {
      const promise = requestToken(s, timeoutMs).then(
        (t) => {
          cached = { key, ...t };
          if (pending?.promise === promise) pending = null;
          return t.token;
        },
        (err) => {
          if (pending?.promise === promise) pending = null;
          throw err;
        }
      );
      pending = { key, promise };
    }
    return pending.promise;
  }

  /** One call to the platform API: resolves its JSON on 2xx (an empty answer is {}), else a PlatformError. */
  async function call(method, path, body = null, timeoutMs = PLATFORM_TIMEOUT_MS, retried = false) {
    const s = settings();
    const bearer = await token(s, timeoutMs);
    let response;
    let payload;
    try {
      response = await fetch(`${s.apiUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${bearer}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!text) payload = response.ok ? {} : null;
      else {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
    } catch (err) {
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      // the method and route only: never the request (its headers carry the token)
      console.error(tag, method, path.split("?")[0], timedOut ? "timed out" : `failed (${err?.name || "error"})`);
      throw unavailable(timedOut ? "The Figbloom platform didn't answer in time. Try again." : undefined);
    }

    if (response.ok) {
      if (payload === null || typeof payload !== "object") throw unavailable();
      return payload;
    }
    if (response.status === 401 || response.status === 403) {
      resetToken();
      if (!retried) return call(method, path, body, timeoutMs, true);
      console.error(tag, `the platform refused ${who.toLowerCase()}'s credential`, response.status);
      throw unavailable(`The Figbloom platform refused ${who.toLowerCase()}'s connection. Check its settings.`);
    }
    if (response.status >= 400 && response.status < 500) {
      const e = payload?.error;
      const code = typeof e?.code === "string" && CODE_RE.test(e.code) ? e.code : "platform_error";
      const message = typeof e?.message === "string" && e.message.trim() ? e.message.trim().slice(0, 500) : "The Figbloom platform refused the request.";
      throw new PlatformError(response.status, code, message);
    }
    console.error(tag, method, path.split("?")[0], "answered", response.status);
    throw unavailable();
  }

  /** Whether every setting this client needs is there. */
  const configured = () => {
    try {
      settings();
      return true;
    } catch {
      return false;
    }
  };

  return { call, resetToken, configured };
}
