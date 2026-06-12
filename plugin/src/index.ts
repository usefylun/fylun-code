import http from "node:http"
import crypto from "node:crypto"
import type { AddressInfo } from "node:net"
import type { Plugin } from "@opencode-ai/plugin"

// ---------------------------------------------------------------------------
// Endpoints. None of these exist on fylun-web yet — they are the contract the
// web side has to implement (see README "fylun-web work"). Overridable via env
// for local development against a dev server.
// ---------------------------------------------------------------------------
const API_BASE_URL = process.env["FYLUN_API_URL"] ?? "https://fylun.ai/api/v1"
const OAUTH_AUTHORIZE_URL = process.env["FYLUN_OAUTH_AUTHORIZE_URL"] ?? "https://fylun.ai/oauth/authorize"
const OAUTH_TOKEN_URL = process.env["FYLUN_OAUTH_TOKEN_URL"] ?? "https://fylun.ai/api/oauth/token"
// Hosted result pages the loopback redirects to, so the user lands back on
// fylun.ai instead of staring at a bare http://127.0.0.1:<port> address.
const FYLUN_WEB_URL = process.env["FYLUN_WEB_URL"] ?? "https://fylun.ai"
const OAUTH_CLIENT_ID = "fylun-code"
const PROVIDER_ID = "fylun"

// Refresh slightly before actual expiry so an in-flight request never races it.
const EXPIRY_MARGIN_MS = 30_000

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
}

function base64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function makePkce() {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest())
  return { verifier, challenge }
}

async function exchangeToken(body: Record<string, string>): Promise<TokenResponse | undefined> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  }).catch(() => undefined)
  if (!res || !res.ok) return undefined
  return (await res.json().catch(() => undefined)) as TokenResponse | undefined
}

/**
 * Spin up a one-shot loopback server for the OAuth redirect, in the style of
 * the Claude Code / codex-auth login flow. Resolves with the authorization
 * code once the browser hits the redirect URI.
 *
 * The browser is immediately 302-redirected off the loopback to a branded
 * result page on fylun.ai, so the user never lingers on a bare
 * http://127.0.0.1:<port> address.
 */
function listenForCallback(expectedState: string) {
  let resolveCode: (code: string | undefined) => void
  const code = new Promise<string | undefined>((resolve) => {
    resolveCode = resolve
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/callback") {
      res.writeHead(404).end()
      return
    }
    const ok = url.searchParams.get("state") === expectedState && url.searchParams.get("code")
    const dest = `${FYLUN_WEB_URL}/code/${ok ? "connected" : "connect-failed"}`
    // Tiny body with both a meta-refresh and a link as a fallback in case the
    // 302 Location is ignored; normally the browser follows the redirect.
    res.writeHead(302, {
      Location: dest,
      "Content-Type": "text/html; charset=utf-8",
    })
    res.end(
      `<!doctype html><meta http-equiv="refresh" content="0;url=${dest}"><a href="${dest}">Continue</a>`,
    )
    resolveCode(ok ? url.searchParams.get("code")! : undefined)
  })

  const ready = new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port))
  })

  return {
    ready,
    code,
    close: () => server.close(),
  }
}

export const FylunAuthPlugin: Plugin = async ({ client }) => {
  // Persist rotated tokens back to auth storage (auth.json) so refreshes
  // survive restarts. Failures here are non-fatal: the session keeps working
  // with the in-memory token until expiry.
  async function persist(tokens: TokenResponse) {
    await client.auth
      .set({
        path: { id: PROVIDER_ID },
        body: {
          type: "oauth",
          access: tokens.access_token,
          refresh: tokens.refresh_token,
          expires: Date.now() + tokens.expires_in * 1000,
        },
      })
      .catch(() => undefined)
  }

  // Single-flight refresh. opencode fires several requests at once (the title
  // + build agents both stream on a turn). The server rotates refresh tokens
  // on use, so parallel refreshes race: the first rotates the token, the rest
  // get invalid_grant, and across cycles the stored refresh token ends up
  // revoked with no valid replacement — permanent "invalid credentials" until
  // re-login. Coalescing to one refresh per expiry (concurrent callers await
  // the same result, then read the freshly persisted token) removes the race.
  let refreshInFlight: Promise<TokenResponse | undefined> | null = null;
  function coalescedRefresh(refreshToken: string): Promise<TokenResponse | undefined> {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          const tokens = await exchangeToken({
            grant_type: "refresh_token",
            client_id: OAUTH_CLIENT_ID,
            refresh_token: refreshToken,
          });
          // Persist before clearing the in-flight latch so the next request's
          // getAuth() reads the rotated token instead of re-refreshing.
          if (tokens) await persist(tokens);
          return tokens;
        } finally {
          refreshInFlight = null;
        }
      })();
    }
    return refreshInFlight;
  }

  return {
    auth: {
      provider: PROVIDER_ID,
      methods: [
        {
          type: "oauth",
          label: "Log in with Fylun (browser)",
          async authorize() {
            const { verifier, challenge } = makePkce()
            const state = base64url(crypto.randomBytes(16))
            const callback = listenForCallback(state)
            const port = await callback.ready
            const redirectUri = `http://127.0.0.1:${port}/callback`

            const url = new URL(OAUTH_AUTHORIZE_URL)
            url.searchParams.set("response_type", "code")
            url.searchParams.set("client_id", OAUTH_CLIENT_ID)
            url.searchParams.set("redirect_uri", redirectUri)
            url.searchParams.set("code_challenge", challenge)
            url.searchParams.set("code_challenge_method", "S256")
            url.searchParams.set("state", state)
            url.searchParams.set("scope", "chat models usage")

            return {
              url: url.toString(),
              instructions: "Finish logging in to Fylun in your browser.",
              method: "auto",
              callback: async () => {
                const code = await callback.code
                callback.close()
                if (!code) return { type: "failed" }

                const tokens = await exchangeToken({
                  grant_type: "authorization_code",
                  client_id: OAUTH_CLIENT_ID,
                  code,
                  code_verifier: verifier,
                  redirect_uri: redirectUri,
                })
                if (!tokens) return { type: "failed" }

                return {
                  type: "success",
                  access: tokens.access_token,
                  refresh: tokens.refresh_token,
                  expires: Date.now() + tokens.expires_in * 1000,
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "Fylun API key",
          prompts: [
            {
              type: "text",
              key: "key",
              message: "Fylun API key (fylun.ai → Settings → API Keys)",
              placeholder: "fyl_...",
              validate: (value) => (value.trim().length > 0 ? undefined : "API key is required"),
            },
          ],
          async authorize(inputs) {
            const key = inputs?.["key"]?.trim()
            if (!key) return { type: "failed" }
            return { type: "success", key }
          },
        },
      ],
      loader: async (getAuth) => {
        return {
          baseURL: API_BASE_URL,
          // @ai-sdk/openai-compatible requires an apiKey; the real credential
          // is injected per-request below so refreshed tokens are picked up.
          apiKey: "fylun-managed",
          async fetch(input: string | URL | Request, init?: RequestInit) {
            const auth = await getAuth()

            let bearer: string | undefined
            if (auth.type === "api") {
              bearer = auth.key
            } else if (auth.type === "oauth") {
              if (auth.expires - EXPIRY_MARGIN_MS < Date.now()) {
                const tokens = await coalescedRefresh(auth.refresh)
                if (tokens) bearer = tokens.access_token
              }
              bearer ??= auth.access
            }

            const headers = new Headers(init?.headers)
            if (bearer) headers.set("Authorization", `Bearer ${bearer}`)
            return fetch(input, { ...init, headers })
          },
        }
      },
    },
  }
}

// opencode's plugin loader reads `module.default` and requires an object with
// a `server()` function (the v1 PluginModule shape `{ id?, server, tui? }`) —
// a bare default-exported function is rejected as "must default export an
// object with server()". Export both: the object for opencode, and the named
// function for anyone importing it directly.
export default { id: "opencode-fylun-auth", server: FylunAuthPlugin }
