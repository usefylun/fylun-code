# Plan: OpenAI Responses-API reasoning persistence through the Fylun gateway

**Status: IMPLEMENTED (pending prod deploy + E2E).** Originally parked; greenlit and
built 2026-07-07 after the Phase-0 spike collapsed the cost dramatically (see
"Phase 0 findings"). Gateway endpoint lives in fylun-web; CLI side is a catalog-only
change in `distribution/models-fylun.json` — **zero new overlay patches**.
**Sequencing is load-bearing:** the catalog change must not ship in a CLI release
until `/api/v1/responses` is deployed to prod, or GPT-5.x/o3 requests 404 for every
CLI user. Written 2026-07-07 against opencode v1.17.14.

---

## Phase 0 findings (2026-07-07) — why this got dramatically cheaper

All verified in source, not docs:

1. **opencode resolves the SDK per-MODEL, not per-provider.**
   `provider/provider.ts:1201`: `npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"`,
   and the models.dev schema (`core/src/models-dev.ts:95`) carries an optional
   per-model `provider: { npm?, api? }`. So individual catalog entries can opt into
   `@ai-sdk/openai` while the rest of the fylun provider stays openai-compatible.
2. **`@ai-sdk/openai` 3.0.53's `languageModel()` IS the Responses transport.**
   `createLanguageModel → createResponsesModel` → POST `{baseURL}/responses`. With the
   fylun provider's baseURL (`https://fylun.ai/api/v1`), those models automatically hit
   our `/api/v1/responses`. opencode's generic path (`sdk.languageModel(model.api.id)`)
   needs no custom loader.
3. **opencode already configures stateless persistence for that npm.**
   `provider/transform.ts`: models with `api.npm === "@ai-sdk/openai"` get
   `store: false`, `include: ["reasoning.encrypted_content"]`, `reasoningSummary:
   "auto"`, and reasoning-effort variants — automatically. Nothing to patch.
4. **The AI SDK round-trips the encrypted reasoning.** `@ai-sdk/openai` dist:
   reasoning parts carry `providerOptions.openai.reasoningEncryptedContent`; on the
   next call `lowerMessages` re-inlines `encrypted_content` (stateless replay) or
   `item_reference` (stateful — we force stateless). opencode persists message parts
   with providerMetadata, so the blob survives between turns client-side.

Net: the "6th overlay patch" from the original plan is **unnecessary**. The CLI side
is: mark OpenAI-family models in `distribution/models-fylun.json` with
`"provider": {"npm": "@ai-sdk/openai"}`. The gateway side is the new
`/api/v1/responses` route (see Architecture).

### Why persistence doesn't "flow through automatically" (FAQ)

fylun-web's own chat already calls OpenAI over the Responses transport
(`packages/ai/src/providers.ts:1020`), so people reasonably ask why the CLI doesn't
inherit persistence. Because persistence is an **end-to-end round trip**, not a
per-hop property:

```
Turn N:   OpenAI ──encrypted reasoning──▶ fylun-web ──▶ CLI     [CLI must STORE it]
Turn N+1: CLI [must REPLAY it] ──▶ fylun-web ──▶ OpenAI          [decrypts, continues]
```

The CLI↔fylun-web wire spoke chat-completions, which has **no field** that can carry
OpenAI's encrypted reasoning items — so the CLI never received or replayed them, and
the gateway (stateless, verified) kept nothing either. Every web→OpenAI Responses call
therefore arrived with an empty reasoning history. Fixing it means upgrading that
wire itself to the Responses protocol — which is exactly what this plan does.
Note the same limitation applies to fylun-web's own chat UI: it uses the Responses
transport per-turn but persists only reasoning *text*, not the encrypted blobs, so
web chat does not replay reasoning across turns today either (acceptable — chat is
conversational; the CLI's agentic tool loops are where persistence pays).

### OpenAI trajectory (2026-07 research) — why this won't self-heal

- OpenAI recommends Responses for all new projects; reasoning persistence
  (`store:true` or stateless `encrypted_content`) is Responses-only **by design**.
- Chat Completions is "supported indefinitely" but frozen for new capability — e.g.
  starting with GPT-5.4, tool calling is not supported in Chat Completions with
  `reasoning: none`.
- OpenAI's own evals: Responses gives reasoning models ~3% SWE-bench and 40–80%
  better cache utilization vs Chat Completions. The gap widens; it won't converge.

---

## TL;DR

- **What's missing:** when a user drives GPT-5.x (or o-series) *through Fylun Code*,
  the model's reasoning does **not** persist across turns. Native opencode + a direct
  OpenAI key does persist it (Codex-style).
- **Why:** OpenAI put reasoning persistence behind its **Responses API**. opencode
  routes its first-party `openai` provider through Responses; it routes custom /
  openai-compatible providers (us) through `/chat/completions`, which has no
  reasoning-item carry-over. This is OpenAI-specific — **Claude and Gemini already
  persist reasoning through our `/chat/completions` gateway** via the
  `reasoning_details` round-trip + `signature-store.ts`.
- **The fix, in one line:** add a `POST /api/v1/responses` endpoint that thin-proxies
  OpenAI's Responses API for OpenAI-family models only, plus one overlay patch so the
  `fylun` provider routes those models down opencode's `OpenAIResponses.route` instead
  of `openai-compatible-chat`.
- **Cost/benefit:** a second wire protocol + a 6th patch, benefiting one provider
  family on long agentic loops only. Recommended only on a concrete signal.

---

## Goal / definition of done

Driving `gpt-5.x` / `o3*` through Fylun Code, a multi-step tool loop carries the
model's encrypted reasoning from turn N into turn N+1 — verifiable by inspecting the
outbound request (turn N+1's `input` contains the reasoning item from turn N) and by
observed quality/behavior parity with `opencode` on a native OpenAI key. Billing,
quota, model-gating, and streaming all work as they do for `/v1/chat/completions`.

Non-goals: reasoning persistence for non-OpenAI models (structurally impossible —
see below); stateful server-side conversation storage in Fylun.

---

## Why it isn't free today (verified against source)

- `upstream/packages/llm/src/providers/openai.ts` — the native `openai` provider's
  `routes = [OpenAIResponses.route, OpenAIResponses.webSocketRoute, OpenAIChat.route]`
  with Responses first, and `model: responses`. First-party OpenAI ⇒ Responses API.
- `upstream/packages/llm/src/protocols/openai-compatible-chat.ts` — custom providers
  hit `endpoint: "/chat/completions"` reusing `OpenAIChat.protocol`. **Fylun is
  registered as an openai-compatible provider**, so we land here. No reasoning carry.
- `upstream/packages/llm/src/protocols/openai-responses.ts` — the persistence lives
  here: `OpenAIResponsesReasoningItem` with **`encrypted_content`**, the `store` flag,
  and `lowerMessages` folding reasoning items back into `input` each turn.
- fylun-web `apps/main/src/lib/openai-compat/` — our `/v1/chat/completions` already
  does the *equivalent* for Anthropic/Gemini: `translate.ts` + `schema.ts`
  `reasoning_details` round-trip and `signature-store.ts` (Redis, keyed by tool_call
  id). **So the gap is OpenAI-only, by OpenAI's design**, not a Fylun oversight.

### The enabler: we can stay stateless (`openai-responses.ts:346-392`)

`lowerMessages` branches on `store`:

- `store !== false` (opencode's default) → emits `{ type: "item_reference", id }` and
  relies on **OpenAI server-side** state for that reasoning item.
- `store === false` → inlines the **full reasoning item including `encrypted_content`**
  into `input` every turn.

If we force `store: false` for the `fylun` Responses route, opencode replays the
encrypted reasoning blob on each turn and **Fylun holds no state** — we just pass the
opaque `encrypted_content` through to OpenAI, which is the only party that can decrypt
it. That is the whole trick, and it's why this is a *thin proxy*, not a stateful
subsystem.

---

## Scope decision (do first)

- **In:** OpenAI-family reasoning models routed through Fylun — `gpt-5.x`, `gpt-5*`,
  `o3`, `o3-pro`, `o3-mini`, and future OpenAI reasoning SKUs.
- **Out (hard):** every non-OpenAI model. `encrypted_content` is OpenAI-proprietary
  and opaque; we cannot fabricate or translate it. A `/v1/responses` request naming a
  non-OpenAI model returns `400` with a clear "use /v1/chat/completions" message.
- **Mixed-thread caveat:** if a user switches from `gpt-5.5` to `claude-sonnet-5`
  mid-conversation, GPT reasoning items can't be replayed to Claude. opencode's client
  already scopes reasoning items per-provider, but we must confirm and not choke on a
  thread that carries foreign reasoning items.

---

## Architecture — two pieces

### Piece 1 — fylun-web: `POST /api/v1/responses` (thin OpenAI proxy)

A new route mirroring `apps/main/src/app/api/v1/chat/completions/` but speaking the
Responses protocol. For OpenAI-family models it is essentially a **credentialed,
metered passthrough** to `https://api.openai.com/v1/responses`.

Responsibilities:

1. **Auth** — reuse `resolveApiAuth` (Bearer OAuth access token or `fyl_` key) →
   userId. Same as chat-completions.
2. **Model gating** — resolve the requested model, `checkModelAccess(userId, model)`,
   plan-tier enforcement identical to chat-completions. Reject non-OpenAI models.
3. **Force `store: false`** on the upstream request and set
   `include: ["reasoning.encrypted_content"]` so OpenAI returns the encrypted reasoning
   for the client to replay. (Belt-and-suspenders — the overlay route also sets it.)
4. **Proxy** the `input` items (system/user/assistant/tool + reasoning items with
   `encrypted_content`) straight through to OpenAI with Fylun's OpenAI key. Do **not**
   translate reasoning items — pass opaque.
5. **Stream translation** — Responses SSE is a different event set
   (`response.created`, `response.output_item.added`, `response.output_text.delta`,
   `response.reasoning_summary_text.delta`, `response.completed`, …). Proxy the stream
   through faithfully; opencode's Responses client consumes these events directly.
   Non-streaming path first, streaming second.
6. **Billing** — read usage from the Responses result
   (`usage.input_tokens`, `usage.output_tokens`,
   `usage.output_tokens_details.reasoning_tokens`), apply `FYLUN_MARKUP`, debit the
   shared credit ledger via the durable usage path; quota service tag
   `cli_openai_responses`. Reasoning tokens are billed as output tokens (confirm
   pricing multiplier per model).
7. **Errors** — map OpenAI errors + our quota/credit errors to the same
   `429` / `402` semantics as chat-completions.
8. **No server-side state** — with `store:false` there is nothing to persist. (If we
   ever chose the stateful variant, we'd need Redis keyed by `previous_response_id` —
   deliberately avoided; see Alternatives.)

Shared code: factor the auth + gating + billing helpers out of the chat-completions
route so both endpoints reuse them (don't fork the quota/credit logic).

### Piece 2 — fylun-code: overlay patch `12-openai-responses-route.patch`

Make the `fylun` provider send OpenAI-family models down
`OpenAIResponses.route` (endpoint `/responses`, baseURL = Fylun `/v1`) instead of
`openai-compatible-chat`, and set `store:false` + the `encrypted_content` include on
that route.

Open questions for the patch (resolve in the spike):

- **Where opencode selects the protocol for a custom provider.** Today the fylun
  provider is defined via the baked models.dev catalog (patch 06) as openai-compatible
  ⇒ chat route. We need per-model route selection: OpenAI-family fylun models → Responses
  route; everything else → compatible-chat. Determine whether this is expressible in the
  provider/catalog config (`npm`/`models.dev` provider shape, route override) or requires
  patching `provider.ts` / `route/*`.
- **Keep the diff surgical.** Ideally the routing is data-driven (catalog/config) so the
  patch is tiny or even zero — a config change in `distribution/` rather than a code
  patch. Prefer that; a code patch is the fallback.
- **Windows/websocket route** — opencode also has `OpenAIResponses.webSocketRoute`;
  we only need the HTTP route. Ensure we don't accidentally opt into websockets.

---

## Hard parts / risks

1. **Two protocols to maintain forever.** Responses is a separate, actively-evolving
   OpenAI API. Every field/streaming-event they add is new surface for our proxy. This
   roughly doubles gateway protocol maintenance — for one provider family.
2. **Opaque coupling to OpenAI.** We pass `encrypted_content` we can't inspect; if
   OpenAI changes its shape/lifetime we're exposed. Zero leverage across the catalog.
3. **Overlay drift.** A 6th patch (if needed) touches opencode's provider routing —
   more re-derivation surface on every upstream bump. Mitigate by doing it via config,
   not code, if possible.
4. **Streaming fidelity.** If we drop or reorder a Responses event opencode expects,
   its client breaks in ways chat-completions never would. Needs careful event
   passthrough + tests.
5. **Billing correctness for reasoning tokens.** Reasoning tokens must be metered and
   marked-up correctly; a proxy makes it easy to under/over-count if we read the wrong
   usage field.
6. **Request bloat with `store:false`.** Encrypted reasoning is re-sent each turn.
   Fine for correctness; watch payload size on very long agentic loops.

---

## Phased implementation

- **Phase 0 — Spike (½–1 day).** Confirm: (a) opencode honors `store:false` for a
  custom provider and replays `encrypted_content`; (b) exact SSE event list opencode's
  Responses client consumes; (c) how to route only OpenAI-family fylun models to the
  Responses route (config vs patch); (d) which fylun model ids are OpenAI-family.
- **Phase 1 — Gateway, non-streaming.** `/api/v1/responses` proxy for OpenAI models:
  auth, gating, `store:false`+include, passthrough, usage→billing, non-OpenAI reject.
  Unit tests in `openai-compat/__tests__`.
- **Phase 2 — Gateway, streaming.** Faithful Responses SSE passthrough + post-stream
  durable usage recording.
- **Phase 3 — Overlay routing.** Config or `patch 12` to route OpenAI-family fylun
  models through the Responses route pointed at Fylun `/v1`. Rebuild; verify all
  patches still apply.
- **Phase 4 — E2E + guardrails.** `fylun-code run` a multi-step tool loop on `gpt-5.5`;
  inspect turn N+1's request for the turn-N reasoning item; confirm quality parity with
  native opencode. Handle model-switch-mid-thread; reconcile billing.

---

## How we prove it works

1. **Wire inspection:** log/capture the outbound OpenAI request on turn N+1; assert its
   `input` contains a `type:"reasoning"` item with the `encrypted_content` produced on
   turn N. (This is the literal definition of persistence.)
2. **Behavioral:** a fixed multi-step agentic task run twice — once via
   `/v1/chat/completions` (no persistence), once via `/v1/responses` — compare
   step count / coherence / reasoning-token usage.
3. **Billing:** confirm reasoning tokens are metered with markup and match OpenAI's
   reported usage.
4. **Regression:** non-OpenAI model on `/v1/responses` → clean `400`; Claude/Gemini
   unaffected on chat-completions.

---

## Effort & decision gate

- **Rough size:** Phase 1–2 (gateway) ≈ the bulk of the work — a second protocol adapter
  with streaming + billing, call it a few focused days. Phase 3 small if config-driven,
  medium if it needs a routing patch. Phase 4 a day of real-agent testing.
- **Do it only if** one of these is true:
  - Real users run **heavy GPT-5.x autonomous tool loops through Fylun Code** and report
    quality degradation vs Codex.
  - We make a deliberate product bet to position Fylun Code as an **OpenAI-agentic-coding**
    competitor (not just breadth).
- **Otherwise:** stay parked. Fylun's leverage is breadth (every model, one login), and
  the two coding models that matter most (Claude, Gemini) already persist reasoning.
  This closes a gap only on the family where using OpenAI/Codex directly is inherently
  better anyway.

---

## Alternatives considered

- **Do nothing (current).** Correct default. Reasoning still works within a turn; only
  cross-turn reuse is lost, OpenAI-only.
- **Stateful proxy (`store:true` + `item_reference` + `previous_response_id`).** Even
  thinner request payloads, but couples conversation continuity to OpenAI's server-side
  item retention (expiry → mid-thread breakage) and forces Fylun to track response ids.
  Rejected in favor of the stateless `store:false` passthrough.
- **Fake persistence on chat-completions.** Impossible — `encrypted_content` can't be
  produced or consumed outside OpenAI; there's no chat-completions field that carries it.

---

## Related

- `README.md` → "Known residual gaps" (item 1) and the overlay patch table.
- Gateway equivalent already shipped for Anthropic/Gemini:
  `fylun-web/apps/main/src/lib/openai-compat/{translate,schema,signature-store}.ts`.
- opencode source of truth: `upstream/packages/llm/src/protocols/openai-responses.ts`,
  `providers/openai.ts`, `protocols/openai-compatible-chat.ts`.
