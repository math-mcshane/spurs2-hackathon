# Unified data model — REROUTE

Canonical entities for Rights & Compliance. ScorePlay remains system of record for binaries; REROUTE owns decisions, receipts, and resolution plans.

## Layers

```text
ScorePlay (media)  →  Observations (TwelveLabs)  →  Entitlements (policy packs)
                              ↓
                     PublishIntent + Edit
                              ↓
                     Decision (per segment + whole edit)
                              ↓
                     Alternative → RenderJob → RightsReceipt → writeback
```

## Verdict vocabulary (aligned)

| REROUTE | CLEAR (legacy UI) | Meaning |
|---------|-------------------|---------|
| `ALLOWED` | `CLEARED` | All mandatory packs affirmatively cover the intent |
| `NEEDS_REVIEW` | `REVIEW` | Missing / ambiguous fact or entitlement |
| `BLOCKED` | `BLOCKED` | Verified prohibition or expiry |

Prefer **REROUTE** names in new code. Map CLEAR UI labels at the edge.

## Core entities

### Identity & media (ScorePlay-shaped)

- **Org** — club / company (`company_id`)
- **Collection / Event** — match or content day
- **Media (Asset)** — photo or video; `scoreplay_media_id`; `tl_source_url` (ScorePlay URL → TwelveLabs)
- **Version** — edit lineage (original vs REROUTE output)
- **File / Rendition** — photographer / compressed / thumbnail URLs
- **Tag** — ScorePlay tag_option links (players, venues, metadata)

Hierarchy (from CLEAR discovery): `Collection → Media → Version → File`.

### Creative structure (REROUTE)

- **Edit** — ordered list of **Segments** (timeline of an intended publishable cut)
- **Segment** — `[start_s, end_s]`, source media ref, optional observation ids
- **PublishIntent** — territory, platform, usage (`organic` \| `sponsored` \| `paid`), competition, publish_at, optional advertiser/campaign

### Observations (TwelveLabs — never grants rights)

- **ObservationRun** — model/index versions, asset URL used, cached flag
- **Observation** — question id / label, value, timecodes, citations  
  Maps to sample prompt sections: RIGHTS-01/02, MEDIA-01/02, PLAYER-02/03, VENUE-02, etc.

### Entitlements (multi-stakeholder packs)

- **PolicyPack** — `league` \| `team` \| `player` \| `territory` \| `advertiser` \| `platform`
- **PolicyRule** — rule_id, dimension, severity (`block` \| `restrict` → maps to BLOCKED; `warn` → often NEEDS_REVIEW), parameters, version, DEMO label
- **EntitlementFact** — authoritative claim from ScorePlay metadata / DEMO seed (not inferred from pixels alone)

### Decisions & resolution

- **PackDecision** — one pack’s result for an edit or segment
- **Decision** — composed worst-of packs; reasons; evidence refs; policy versions
- **Alternative** — candidate segment/media from Marengo search + ScorePlay map; own Decision
- **ResolutionPlan** — which segments to replace; ranked alternatives; min-edit choice
- **RenderJob** — FFmpeg inputs/outputs; before/after version ids
- **RightsReceipt** — audit JSON: intent, policies, evidence, verdict, replacements, timestamps
- **WritebackEvent** — ScorePlay tag/metadata sync status

## Required dimensions (hackathon brief + extensions)

| Dimension | Primary pack(s) | Observation aid |
|-----------|-----------------|-----------------|
| Territory | territory | — (intent) |
| Platform | platform / league | — (intent) |
| Competition | league | competition_source |
| Sponsor visibility | advertiser + league | sponsors_seen, uniform_logo |
| Expiration | league / campaign | — (entitlement dates) |
| Usage (organic/sponsored/paid) | advertiser + team | archival_sponsored, player_focus |
| Broadcast provenance | league | broadcast_source, scorebug |
| Player likeness / NIL | player | player_focus, players_named |
| Restricted access | team | restricted_zone, sensitive_audio |
| Third-party IP | league / team | (e.g. NFL marks) → NEEDS_REVIEW if unknown |

## Invariants

1. Observations ≠ permissions.
2. Missing evidence of restriction is **not** permission → `NEEDS_REVIEW`.
3. Every Alternative is evaluated independently before substitution.
4. Composite edit after FFmpeg is fully re-evaluated.
5. Verdicts and receipts are append-only; policy packs are versioned.
6. DEMO packs must be labeled; never imply real Spurs/NBA/PL legal clearance.

## TypeScript source of truth

- **Runtime app contracts:** [`../reroute/src/lib/contracts.ts`](../reroute/src/lib/contracts.ts) (prefer this for REROUTE shapes).
- **Earlier sketch types:** [`schemas/unified-cdm.types.ts`](./schemas/unified-cdm.types.ts) (align to contracts when they diverge).

## Where data lives (Supabase vs Unity Catalog)

See **[CDM_PLATFORM_PLAN.md](./CDM_PLATFORM_PLAN.md)** for the full placement matrix, proposed Postgres DDL, UC medallion schemas, sync patterns, and phased rollout.

| Platform | Role |
|----------|------|
| ScorePlay | Media SoR |
| TwelveLabs | Vision SoR |
| Supabase | App OLTP CDM (intents, edits, decisions, receipts, reviews) |
| Databricks UC | Analytics lake (bronze → silver → gold + policy history) |
| `.data/` today | Hackathon file store until Supabase is wired |
