# Supported user journeys

Personas and journeys for REROUTE (+ CLEAR UGC where it feeds the same CDM).

## Personas

| Persona | Goal | Primary surfaces |
|---------|------|------------------|
| **Media producer** | Ship a cut for a channel/market today | Studio, Policy Dial, Reroute, Receipt |
| **Rights / compliance ops** | Explain and audit decisions | Evidence drawer, Receipt, Review queue |
| **Social / campaign manager** | Set sponsored vs organic intent | Policy Dial |
| **Creator (fan UGC)** | Grant scoped license (CLEAR) | Creator flow |
| **Approver (editor / legal lite)** | Human gate before publish | Review queue, approve writeback |
| **Integration engineer** | Keep SP / TL healthy | Integrations / ops (secondary) |

## Journey A — Producer: sponsored Spurs IG (P0 demo)

**Intent:** 15s sponsored Instagram, France, partner campaign, Oct 24 (DEMO policy).

1. Open Studio → load ScorePlay edit (3 segments).
2. Set Policy Dial: territory=FR, platform=instagram, usage=sponsored, competition=NBA, campaign=DEMO.
3. Run Check → `BLOCKED` on 00:04–00:09 (competing brand observation + advertiser pack).
4. Open Evidence → rule id, timecode, TwelveLabs citation.
5. **Find compliant path** → Marengo similar dunks → ScorePlay assets → each Alternative evaluated.
6. Accept REROUTE → FFmpeg render → new Version.
7. Re-check whole edit → `ALLOWED` under DEMO packs.
8. Download Rights Receipt → optional ScorePlay writeback → human approve.

## Journey B — Producer: organic vs sponsored flip

1. Same edit, usage=organic → often `ALLOWED` or softer warn.
2. Flip Dial to sponsored → verdict changes without re-upload.
3. Jury takeaway: rights depend on **how/where**, not only pixels.

## Journey C — Multi-rights-holder (Tottenham / NFL venue)

1. Load venue promo with stadium + third-party NFL game footage.
2. Team pack may allow venue; league/third-party pack returns `NEEDS_REVIEW` for NFL marks (no entitlement on file).
3. REROUTE searches cleared venue-only alternatives.
4. Receipt shows missing entitlement, not silent allow.

## Journey D — Rights ops: review queue

1. Filter `NEEDS_REVIEW` / `BLOCKED`.
2. Open evidence + pack breakdown (league / team / player / territory / advertiser).
3. Override only with attested reason (append-only) → or request more facts.
4. Never convert unknown → `ALLOWED` without new entitlement.

## Journey E — Creator UGC (CLEAR → same CDM)

1. Creator submits clip + identity + ownership attestation.
2. Micro-license scope (platforms, territory, paid, duration).
3. Analysis signals (music, minor, third-party) → Decision.
4. Cleared assets become ScorePlay-ready Media with entitlement facts REROUTE can consume.

## Journey F — Failure / no path

1. Check → `BLOCKED`; Find path → no eligible Alternative.
2. System stays `NEEDS_REVIEW` or `BLOCKED`; suggests human outreach.
3. Receipt still issued (audit of attempt).

## Journey map (summary)

```text
Creator ──CLEAR──► Media + EntitlementFacts ──┐
                                              ├──► Edit + PublishIntent
Producer ──Studio─────────────────────────────┘
                    │
                    ▼
              ObservationRun (TL)
                    │
                    ▼
         PackDecisions → Decision
           │ ALLOWED          │ BLOCKED           │ NEEDS_REVIEW
           ▼                  ▼                   ▼
        Receipt            Reroute loop         Review queue
           │                  │
           ▼                  ▼
     Approve / writeback   RenderJob → re-check
```
