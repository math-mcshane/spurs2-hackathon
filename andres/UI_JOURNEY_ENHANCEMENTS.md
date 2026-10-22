# UI enhancements vs current journey + data model

Review of `reroute/` Studio against [JOURNEY_SIMULATION.md](./JOURNEY_SIMULATION.md), [USER_JOURNEYS.md](./USER_JOURNEYS.md), and [`reroute/src/lib/contracts.ts`](../reroute/src/lib/contracts.ts).

**Today:** one-screen producer app already covers Find → Intent → auto-Decide → Timeline → Find compliant path → Receipt. Below is what to add so the **pitch journey** and **CDM intents** are unmistakable.

---

## 1. What the UI already supports

| Journey step | UI today |
|--------------|----------|
| Select ScorePlay asset | `AssetSearch` + detail hydrate |
| 15s cut 0–4 / 4–9 / 9–15 | `defaultEdit()` |
| Publish intent | `IntentForm` (territory, platform, usage, competition, publishAt) |
| Check rights | Debounced `api.decide` on intent/edit change |
| Per-segment verdicts | `ComplianceTimeline` + `VerdictCard` reasons |
| Find compliant path | `ResolvePanel` → Marengo candidates, apply proposed edit |
| Derived edit + re-decide | `proposed` lane + toast |
| Receipt / review / writeback | `ReceiptPanel` |
| Fictional policy banner | `AppHeader` |
| Human observation | `ObservationForm` |

---

## 2. Intent model gaps (contracts vs journey)

### Current `PublishIntent` (contracts.ts)

```ts
{ territory, platform, usage: ORGANIC|SPONSORED, competition, publishAt }
```

### Journey / CDM extras not in intent yet

| Field | Why | UI impact |
|-------|-----|-----------|
| `campaignId` / `advertiserId` | Journey A “demo-partner-fr”; advertiser pack story | Policy Dial campaign picker |
| `usage: PAID` (optional) | Earlier CDM had paid; contracts are binary ORGANIC/SPONSORED | Keep binary unless policy needs paid |
| Default `competition: "NBA"` | Form starts empty → blocks decide | Prefill from asset fact or demo preset |
| Default `publishAt` | Empty until set | Prefill demo date (e.g. 2026-10-24T12:00:00Z) |

**Engine note:** Demo DENY `SPURS-3-rival-sponsor-exclusivity` only fires on `usage: SPONSORED` + evidence label `brand:rival-sponsor`. Journey B (organic ↔ sponsored flip) only lands if that evidence exists on the middle segment (TL or human).

---

## 3. Priority enhancements (map to surfaces)

### P0 — Make Journey A/B pitch-perfect (same screen)

1. **Demo preset chip** — “Load Spurs FR sponsored demo”  
   - Sets intent: FR · instagram · SPONSORED · NBA · 2026-10-24  
   - Labels segments: Entrance / Dunk / Celebration  
   - Optionally seeds human evidence `brand:rival-sponsor` on 4–9s if TL isn’t configured  

2. **Policy Dial framing** — Rename step 03 to **Policy Dial**; add helper: “Change usage — verdict should flip without re-uploading.”  
   - Pulse/highlight usage when it changes  
   - Show last verdict vs new verdict strip (“ORGANIC → ALLOWED · SPONSORED → BLOCKED”)

3. **Explicit Check (optional mode)** — Keep auto-decide, but add **Check rights** button + “Evaluating…” for jury clarity (journey step 3).

4. **Evidence drawer on segment click** — Click red 4–9s opens drawer:  
   - ruleId (`SPURS-3-…`)  
   - dimension `sponsor`  
   - observation + origin LIVE/CACHED/HUMAN  
   - FICTIONAL DEMO POLICY tag  
   - Deep-link “Find compliant path for this segment”

5. **7-dimension status strip** — From `MANDATORY_DIMENSIONS`: each of territory / platform / usage / competition / people / sponsor / expiry as PERMIT · DENY · MISSING chips (from `decision.reasons`). Makes CDM visible.

6. **Pack / policy context** — Show active `policyId@version` + fictional flag next to Dial (already in header; repeat on Verdict).

### P1 — REROUTE clarity

7. **Before / after dual preview** — When `proposed` exists, split player or A/B toggle (ORIGINAL vs PROPOSED) with synced playhead.

8. **Candidate rights clarity** — On each alternative card: eligible badge + top DENY/MISSING reason (not only verdict).

9. **Segment picker for resolve** — Resolve any BLOCKED/NEEDS_REVIEW segment, not only first blocked index.

10. **Receipt story panel** — Structured “intent → blockers → replacements → final verdict → review” instead of raw-heavy JSON only.

### P2 — Other journeys

11. **Journey C preset** — Tottenham / NFL venue: force NEEDS_REVIEW missing third-party fact.  
12. **Review queue view** — List receipts `PENDING` (Journey D).  
13. **CLEAR entry point** — Link out / embed later (Journey E); not in REROUTE P0.

---

## 4. Suggested UI information architecture (still one page)

```text
[ Demo presets ]  Spurs FR sponsored | Organic flip | Tottenham NFL

LEFT                          RIGHT
01 Find ScorePlay             03 Policy Dial  (+ campaign when added)
02 Player + Timeline          04 Dimension strip + Verdict + reasons
   · segment labels           05 Evidence drawer (or slide-over)
   · ORIGINAL / PROPOSED      06 Find compliant path + candidates
                              07 Receipt · Approve · Writeback
```

Keep one screen; add **guided step highlight** (01→07) that tracks journey state machine:

| State | Highlight |
|-------|-----------|
| `needs_asset` | 01 |
| `needs_intent` | 03 |
| `blocked` | 04–05 |
| `resolving` | 06 |
| `proposed_ok` | 02 proposed + 07 |
| `receipt_pending_review` | 07 |

---

## 5. Data binding checklist (enhance without breaking contracts)

| UI element | Bind to |
|------------|---------|
| Dial fields | `PublishIntent` |
| Timeline colors | `EditDecision.segments[].decision.verdict` |
| Dimension strip | Aggregate `reasons[]` by `dimension` + `outcome` |
| Evidence drawer | `reasons` where DENY/MISSING + `evidence[]` overlapping segment |
| Resolve | `POST /api/resolve` `{ edit, intent, segmentIndex }` |
| Apply candidate | `Candidate.proposedEdit` + `editDecision` |
| Receipt | `RightsReceipt` + `reviews[]` |
| Origin badges | `DataOrigin` on asset / evidence / hits |

**Contract change (only if you want campaign in Dial):** extend `PublishIntentSchema` with optional `campaignId` / `advertiserId`; thread into policy `match` later. Until then, keep campaign as UI-only preset metadata.

---

## 6. Demo reliability (UI + data)

Without TL keys, sponsor DENY may never fire → Journey B fails.

| Enhancement | Purpose |
|-------------|---------|
| “Seed demo rival-sponsor observation” button | Writes HUMAN evidence `brand:rival-sponsor` @ 4–9s |
| Show analysis status | Already shown; add “Demo seed available” CTA beside it |
| Prefill competition + publishAt on asset select | Unblocks decide immediately |

---

## 7. Recommended build order

1. Prefill intent defaults (NBA + publishAt) + segment labels  
2. Demo preset + optional HUMAN evidence seed  
3. Dimension strip + evidence drawer  
4. Dial flip callout (organic ↔ sponsored)  
5. Dual preview / receipt story  
6. Review queue (if time)

---

## 8. Out of scope for UI polish

- Supabase/UC wiring (see [CDM_PLATFORM_PLAN.md](./CDM_PLATFORM_PLAN.md))  
- Multi-pack engine UI before packs exist in `rights/policies`  
- Full CLEAR creator flow inside this app  
