# Journey simulation (docs only — no UI yet)

How to **walk the supported producer journey on paper / in a pitch**, before any Next app.
UI is deferred; this file is the script + expected state at each step.

**Canonical product:** [REROUTE_TEAM_WORKFLOW.md](../REROUTE_TEAM_WORKFLOW.md)  
**Journeys list:** [USER_JOURNEYS.md](./USER_JOURNEYS.md)  
**Surfaces:** [WORKFLOWS_AND_UI.md](./WORKFLOWS_AND_UI.md)  
**Types:** [schemas/unified-cdm.types.ts](./schemas/unified-cdm.types.ts)

---

## Simulation fixture (P0)

| Field | Value |
|-------|--------|
| Club | San Antonio Spurs (DEMO) |
| Edit | 15s cut, 3 segments |
| Intent (default for block) | FR · Instagram · **sponsored** · NBA · 2026-10-24 · campaign `demo-partner-fr` |
| Policy | **DEMO POLICY — NOT AN ACTUAL TEAM OR LEAGUE AGREEMENT** |

### Segments

| ID | Time | Content | Notes |
|----|------|---------|--------|
| `seg-1` | 00:00–00:04 | Player entrance | Eligible under DEMO packs |
| `seg-2` | 00:04–00:09 | Dunk + older brand mark | Conflicts when usage=sponsored |
| `seg-3` | 00:09–00:15 | Celebration | Eligible |

### Observation (cached / DEMO)

```json
{
  "questionId": "sponsors_seen",
  "segmentId": "seg-2",
  "startSeconds": 4,
  "endSeconds": 9,
  "value": ["BrandX"],
  "citation": "LED / jersey patch visible mid-dunk (DEMO observation)",
  "cached": true
}
```

### Competing DEMO rule

```json
{
  "ruleId": "ADV-DEMO-01",
  "packId": "advertiser.demo-partner-fr",
  "dimension": "sponsor_visibility",
  "severity": "block",
  "demoLabel": "DEMO POLICY — NOT AN ACTUAL TEAM OR LEAGUE AGREEMENT",
  "when": "usage=sponsored AND territory=FR AND BrandX observed in segment"
}
```

---

## Journey A — step simulation

### Step 1 — Open Studio (`S-STUDIO`)

**User does:** Select ScorePlay edit “SAS partner cut · 15s”.

**System state:**

- `Edit` loaded with `seg-1..3`
- `Asset.tlSourceUrl` set (ScorePlay URL → TwelveLabs; no download relay)
- No `Decision` yet (or stale)

**Say aloud:** “Producer starts from an existing cut, not a blank editor.”

---

### Step 2 — Set Policy Dial (`S-DIAL`) — Journey B setup

**User does:** Set intent.

| Control | Value |
|---------|--------|
| Territory | FR |
| Platform | instagram |
| Usage | organic → then flip to **sponsored** (show both) |
| Competition | NBA |
| Publish date | 2026-10-24 |
| Campaign | demo-partner-fr |

**System state:** `PublishIntent` updated; evaluation not run until Check.

**Journey B beat:** With **organic**, after Check → often `ALLOWED` or warn-only. Flip to **sponsored** → `BLOCKED` on `seg-2` without re-upload.

**Say aloud:** “Rights depend on how and where we publish, not only what’s in the pixels.”

---

### Step 3 — Check rights (`S-CHECK`)

**User does:** Click **Check rights**.

**Workflow:** W2 evaluate.

**Expected Decision (sponsored):**

| Scope | Verdict | Pack / rule |
|-------|---------|-------------|
| seg-1 | ALLOWED | — |
| seg-2 | **BLOCKED** | advertiser · ADV-DEMO-01 |
| seg-3 | ALLOWED | — |
| **Edit** | **BLOCKED** | worst-of segments |

**Pack breakdown (example):**

| Pack | Verdict |
|------|---------|
| league.nba.demo | ALLOWED |
| team.sas.demo | ALLOWED |
| player.default | ALLOWED |
| territory.fr | ALLOWED (or restrict window — still not the blocker) |
| advertiser.demo-partner-fr | **BLOCKED** |

---

### Step 4 — Inspect failure (`S-EVID`)

**User does:** Click red interval 00:04–00:09.

**Show:**

- Rule `ADV-DEMO-01`
- Observation BrandX + timecode
- DEMO disclosure banner
- “TwelveLabs observed; advertiser pack decided.”

**Say aloud:** “AI finds the mark; the pack blocks. Not the same thing.”

---

### Step 5 — Find compliant path (`S-ALT`)

**User does:** Click **Find a compliant path**.

**Workflow:** W3 — Marengo-like similar dunk search (DEMO candidates).

| Alternative | Asset | Similarity | Independent Decision |
|-------------|-------|------------|----------------------|
| `alt-1` | sp-dunk-clean-a | 0.91 | ALLOWED (no BrandX) |
| `alt-2` | sp-dunk-rival-b | 0.88 | BLOCKED (same ADV-DEMO-01) |
| `alt-3` | sp-dunk-unk-c | 0.84 | NEEDS_REVIEW (no entitlement) |

**System picks:** minimum-change eligible → `alt-1` for `seg-2`.

**Invariant:** `alt-2` / `alt-3` never auto-selected.

---

### Step 6 — REROUTE (`S-REROUTE`)

**User does:** Accept plan → “Render” (DEMO: pretend FFmpeg).

**System state:**

- `ResolutionPlan` with seg-2 → alt-1
- `RenderJob` status `done`
- New `Version` / Edit with replaced middle 5s
- **Full re-check** → edit verdict **ALLOWED**

**Show:** before / after timeline (seg-2 color goes from red → green).

---

### Step 7 — Review + Receipt (`S-RECEIPT`)

**User does:** Open Rights Receipt · optional “Write back to ScorePlay” · Approve.

**Receipt must include:**

- PublishIntent
- policyVersions[]
- evidence summary + DEMO disclosure
- replacements[] (from → to asset, 4–9s)
- final verdict ALLOWED
- writebackStatus: `pending` | `ok` | `skipped`

**Say aloud:** “Auditable path from intent to publishable cut — human still approves.”

---

## Journey C — one-liner (secondary)

Venue promo + NFL marks without entitlement → segment `NEEDS_REVIEW` (not ALLOWED). Receipt shows missing third-party pack fact. Optional: propose venue-only alternative.

---

## Journey E / F — failure modes (say if asked)

| Case | Result |
|------|--------|
| No eligible alternative | Stay BLOCKED / NEEDS_REVIEW; still emit Receipt of attempt |
| Ambiguous observation only | NEEDS_REVIEW — never upgrade to ALLOWED without entitlement |
| CLEAR UGC path | Separate persona; consent → EntitlementFact → later REROUTE input |

---

## Screen checklist (when UI is built later)

Do **not** implement now. When ready, P0 screens are:

1. Studio + timeline  
2. Policy Dial  
3. Check / pack breakdown  
4. Evidence drawer  
5. Alternatives grid  
6. Before/after  
7. Rights Receipt  

See [WORKFLOWS_AND_UI.md](./WORKFLOWS_AND_UI.md).

---

## Pitch close (from team workflow)

> Sports teams don't have a content shortage. They have a usable-content problem.  
> **REROUTE turns compliance from a dead end into a creative path.**
