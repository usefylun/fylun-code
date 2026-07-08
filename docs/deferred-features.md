# Deferred features (planned, not started)

Two Claude-Code-parity features identified 2026-07-07 and deliberately deferred
past v1. Both are credible v1.1+ differentiators; neither blocks launch. Notes below
capture the design thinking so a future session doesn't re-derive it from scratch.

---

## 1. Push-to-talk dictation (hold-key voice-to-text)

Claude Code: hold a key, record mic audio, release → transcribe → insert into the
composer.

**The hard part is terminal-specific, not conceptual.** Terminals don't deliver
key-up events, so literal "hold space" is a heuristic (infer release from the
key-repeat stream going quiet) that fights with typing an actual space. Any real
implementation should start from **toggle semantics** (press to start, press again /
Esc to stop) rather than trying to fake hold-detection — cleaner and more reliable in
a TTY.

**What we already have:**
- `fylun-web`'s `audio.transcribe` tRPC procedure (Whisper) — auth + quota + billing
  already wired. The STT backend is not new work.
- Upstream opencode has **zero** dictation (`packages/tui/src/audio.ts` is playback
  only) — this would be a genuine Fylun differentiator, not catch-up.

**What's missing:**
- Mic **capture** from a terminal process — needs a native recorder (`sox`,
  `ffmpeg`/avfoundation, or a small helper binary) plus macOS mic-permission UX
  (same TCC "Files and Folders"-style friction class documented elsewhere in this
  repo for fd-limit/directory access).
- A TUI keybinding + composer-insert change — this is **real overlay-patch surface**
  (touches TUI input handling), which is the thing we've deliberately kept minimal
  to limit upstream-bump drift (see the 11→13-ish patch table in the README).

**Rough shape if built:** `/mic` command or a toggle key → record → POST to a small
transcription endpoint (reuse `audio.transcribe` via tRPC, or a thin REST wrapper
like `/v1/audio/transcriptions`) → insert result text into the composer.
Estimate: low, a focused day or two, split between capture plumbing and the TUI patch.

**Why deferred:** polish, not launch-critical. Every new TUI patch is permanent
maintenance tax on future upstream bumps (see the openai-responses plan's Phase-0
finding that *avoiding* a patch there was the whole win) — do this once other
higher-leverage patch-surface decisions have settled.

---

## 2. Remote connect (drive a session from a phone / other device)

Claude Code: session reachable from claude.ai web/mobile, either cloud-run or
relayed to your machine.

**Closer than it looks — opencode is client/server by architecture already.** The
TUI is just one client of a local HTTP server (`fylun-code serve` exposes the full
session API). Upstream even ships a web UI package (`packages/app`) that our build
deliberately skips (`--skip-embed-web-ui`) to avoid building it in CI.

### Tiered path

- **Tier 0 — near-free, personal use, works today in spirit:**
  `fylun-code serve` + Tailscale mesh (you already run one) → hit the server from a
  phone browser. Requires re-enabling `packages/app` in the build (build-time cost)
  and a rebrand pass on it (same treatment as the TUI branding patches). No new
  infra. Good spike candidate: re-enable + rebrand, see how far Tailscale-to-phone
  gets with zero backend work.
- **Tier 1 — the real product:** a relay through fylun-web. Local `fylun-code` opens
  an **outbound** WebSocket to `fylun.ai` (sidesteps NAT/port-forwarding entirely);
  phone hits `fylun.ai/code/sessions` (or the mobile app); fylun-web brokers the
  connection. Auth rides existing OAuth. Real engineering (relay infra, a
  mobile-friendly session UI) and **serious security surface** — this remotes a
  shell-capable coding agent, so sloppy auth here is RCE-as-a-service. Needs a
  proper threat-model pass before building, not just a happy-path implementation.
- **Tier 2 — Claude-Code-web parity:** Fylun-hosted cloud sessions in containers.
  Large infra bet; notable synergy with Teploy (container orchestration you're
  already building for a different product).

### Overlap to resolve first

`Sides/Public/agent-inbox` — a federated supervisor for CLI coding agents,
**explicitly including opencode** — already exists and overlaps heavily with Tier 1.
Before building "Fylun Remote," decide whether agent-inbox *is* this product wearing
a different name, or whether ideas get harvested into it (see
`agent-inbox/docs/aispace-harvest.md` for the harvest-pattern precedent from a
different retired project). Don't build a second remote-session product by accident.

**Why deferred:** Tier 0 is a cheap spike worth doing early (mostly answers "is this
even worth it" for near-zero cost); Tier 1+ is a real product decision that needs the
agent-inbox question settled first and a security review before any code.

---

## Related

- `README.md` → overlay patch table (drift-cost context for why dictation's TUI
  patch is a real cost, not a formality).
- `docs/openai-responses-persistence-plan.md` — the sibling "plan doc" pattern this
  file follows; same TL;DR/what's-missing/why/status structure.
- `Sides/Public/agent-inbox/docs/aispace-harvest.md` — precedent for
  harvest-vs-build-new decisions on overlapping products.
