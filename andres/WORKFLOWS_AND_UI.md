# Workflows & app UI surfaces

## System workflows

### W1 — Ingest & observe

```text
ScorePlay media/search|GET
  → map Collection/Media/Version/File + Tags
  → tl_source_url = files photographer|compressed|original_url
  → TwelveLabs assets.create(method=url)   # confirmed for team
  → index (Marengo) + analyze (Pegasus) / or cached ObservationRun
  → persist Observations + model versions
```

### W2 — Evaluate (deterministic)

```text
PublishIntent + Edit + Observations + EntitlementFacts + active PolicyPacks
  → evaluate each Segment
  → compose PackDecisions (league, team, player, territory, advertiser, …)
  → Decision = worst(BLOCKED > NEEDS_REVIEW > ALLOWED)
  → attach rule_ids + evidence timecodes
```

### W3 — Reroute (resolution)

```text
on BLOCKED segment:
  → Marengo search (similar moment)
  → map hits → ScorePlay Media
  → evaluate each Alternative independently (W2)
  → rank: rights pass → similarity → min edit distance
  → ResolutionPlan
  → RenderJob (FFmpeg trim/normalize/concat)
  → new Version/Edit → W2 again on full cut
```

### W4 — Receipt & writeback

```text
RightsReceipt JSON (downloadable)
  → optional ScorePlay rights.* tags / custom fields
  → WritebackEvent status pending|ok|failed|skipped
  → human approval gate before publish
```

### W5 — UGC (CLEAR)

```text
Creator flow → attestation + License + ConsentEvent
  → Analysis signals → Decision
  → producer library → ScorePlay ingest when CLEARED/ALLOWED
```

## App UI surfaces

Product shell: **Next.js** (REROUTE Studio). CLEAR app remains a related UGC surface feeding the same CDM.

| Surface ID | Screen | Primary user | Key components | CDM in/out |
|------------|--------|--------------|----------------|------------|
| `S-LIB` | Asset / edit library | Producer | Search, status chips, event filter | Media, Edit, Decision summary |
| `S-STUDIO` | Edit studio | Producer | Player, segmented timeline, segment chips | Edit, Segment, Observation |
| `S-DIAL` | Policy Dial | Producer / campaign | Territory, platform, usage, competition, date, campaign | PublishIntent |
| `S-CHECK` | Rights check result | Producer / ops | Verdict badge, pack breakdown | Decision, PackDecision |
| `S-EVID` | Evidence drawer | Ops | Timecode, rule id, TL citation, DEMO label | Observation, PolicyRule |
| `S-ALT` | Alternatives | Producer | Candidate grid, rights badge per card | Alternative, Decision |
| `S-REROUTE` | Before / after | Producer | Dual player, diff timeline | ResolutionPlan, Version |
| `S-RECEIPT` | Rights Receipt | Ops / approver | JSON view, download, policy versions | RightsReceipt |
| `S-REVIEW` | Review queue | Approver | NEEDS_REVIEW list, override form | Decision |
| `S-CREATOR` | CLEAR creator flow | Fan creator | Upload, attest, license, accept | Creator, License, ConsentEvent |
| `S-CLEAR-LIB` | CLEAR producer library | Producer | UGC statuses CLEARED/REVIEW/BLOCKED | Asset, RightsDecision |
| `S-INTEG` | Integrations | Engineer | SP/TL mode, whoami, cache flags | Integration config |

## Navigation (REROUTE P0)

```text
Library → Studio
            ├─ Policy Dial (always visible)
            ├─ Check rights
            ├─ Evidence
            ├─ Find compliant path → Alternatives → Reroute preview
            └─ Receipt / Approve
Review queue (ops)
```

## UI → workflow binding

| User action | Workflow | Surfaces |
|-------------|----------|----------|
| Open edit | W1 (cached) | S-LIB → S-STUDIO |
| Change Dial | W2 | S-DIAL → S-CHECK |
| Inspect red segment | — | S-EVID |
| Find compliant path | W3 | S-ALT → S-REROUTE |
| Save decision | W4 | S-RECEIPT |
| Creator submit | W5 | S-CREATOR → S-CLEAR-LIB |

## Hackathon P0 surface cut

**Ship:** S-STUDIO, S-DIAL, S-CHECK, S-EVID, S-ALT, S-REROUTE, S-RECEIPT.  
**Optional:** S-REVIEW, S-CREATOR/CLEAR, S-INTEG.  
**Do not build:** full NLE, multi-market batch UI, contract CMS.
