"""
Rights Passport evaluator (irl.group S-08 / S-09).

Strictest verdict wins per cell. Uncovered cells → review.
Time limits → usable_until; past that date the cell becomes block (expired).
Observations / facts never grant rights alone — rules must fire.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

USES = (
    "instagram",
    "tiktok",
    "youtube",
    "x",
    "club_app",
    "venue_screen",
    "sponsor_use",
)
REGIONS = ("US", "UK", "ROW")

_SEVERITY = {"block": 3, "review": 2, "allow_limited": 1, "allow": 0}


def severity(verdict: str) -> int:
    return _SEVERITY.get(verdict, -1)


def _expand(uses: Any) -> list[str]:
    if uses == "ALL":
        return list(USES)
    return list(uses)


def _expand_regions(regions: Any) -> list[str]:
    if regions == "ALL":
        return list(REGIONS)
    return list(regions)


def _as_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, str) and v:
        return date.fromisoformat(v[:10])
    return None


def _as_dt(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str) and v:
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def rule_matches(rule: dict[str, Any], facts: dict[str, Any]) -> bool:
    """All `when` clauses must match (AND). Missing fact for a positive check → no match
    (safe: uncovered → review later). Negative consent checks treat missing as false."""
    when = rule.get("when") or {}
    for key, expected in when.items():
        if key == "published_on_matches_use":
            continue  # handled per-cell in evaluate_passport
        if key == "minor_visible":
            if "minor_visible" not in facts or bool(facts.get("minor_visible")) != bool(expected):
                return False
        elif key == "guardian_consent":
            if "guardian_consent" not in facts or bool(facts.get("guardian_consent")) != bool(expected):
                return False
        elif key == "unknown_people_over":
            if int(facts.get("unknown_people_count") or 0) <= int(expected):
                return False
        elif key == "fan_consent":
            if "fan_consent" not in facts or bool(facts.get("fan_consent")) != bool(expected):
                return False
        elif key == "source_in":
            src = (facts.get("source") or "").lower()
            if src not in [str(x).lower() for x in expected]:
                return False
        elif key == "source":
            if (facts.get("source") or "").lower() != str(expected).lower():
                return False
        elif key == "music":
            if (facts.get("music") or "").lower() != str(expected).lower():
                return False
        elif key == "rival_logo_visible":
            if "rival_logo_visible" not in facts or bool(facts.get("rival_logo_visible")) != bool(expected):
                return False
        elif key == "shirt_sponsor_visible":
            if "shirt_sponsor_visible" not in facts or bool(facts.get("shirt_sponsor_visible")) != bool(expected):
                return False
        elif key == "use_commercial":
            commercial = bool(facts.get("use_commercial")) or (
                str(facts.get("usage") or "").upper() in ("SPONSORED", "COMMERCIAL")
            )
            if commercial != bool(expected):
                return False
        elif key == "player_visible":
            if "player_visible" not in facts or bool(facts.get("player_visible")) != bool(expected):
                return False
        elif key == "opponent_visible":
            if "opponent_visible" not in facts or bool(facts.get("opponent_visible")) != bool(expected):
                return False
        elif key == "venue_sponsor_conflict":
            if "venue_sponsor_conflict" not in facts or bool(facts.get("venue_sponsor_conflict")) != bool(expected):
                return False
        elif key == "game_still_live":
            if "game_still_live" not in facts or bool(facts.get("game_still_live")) != bool(expected):
                return False
        elif key == "longer_than_sec":
            dur = facts.get("duration_sec")
            if dur is None or float(dur) <= float(expected):
                return False
        elif key == "hours_since_final_whistle_under":
            hours = facts.get("hours_since_final_whistle")
            if hours is None or float(hours) >= float(expected):
                return False
        elif key == "broadcaster_graphics":
            if "broadcaster_graphics" not in facts or bool(facts.get("broadcaster_graphics")) != bool(expected):
                return False
        elif key == "official_watch_party":
            if "official_watch_party" not in facts or bool(facts.get("official_watch_party")) != bool(expected):
                return False
        elif key == "use_editorial":
            editorial = str(facts.get("usage") or "").upper() in ("ORGANIC", "EDITORIAL", "")
            if bool(expected) and not editorial:
                return False
            if not bool(expected) and editorial:
                return False
        elif key == "club_code":
            if str(facts.get("club_code") or "").upper() != str(expected).upper():
                return False
        else:
            return False
    return True


def _fill_reason(template: str, facts: dict[str, Any]) -> str:
    repl = {
        "[unknown people]": str(facts.get("unknown_people_count") or 0),
        "[rival logos]": ", ".join(facts.get("rival_logos") or []) or "rival brand",
        "[rostered players]": ", ".join(facts.get("rostered_players") or []) or "player(s)",
        "[opponent players]": ", ".join(facts.get("opponent_players") or []) or "opponent(s)",
        "[rights partner]": str(facts.get("rights_partner") or "rights partner"),
        "[duration s]": str(int(facts["duration_sec"])) if facts.get("duration_sec") is not None else "?",
        "[published on]": str(facts.get("published_on") or "original platform"),
    }
    out = template
    for k, v in repl.items():
        out = out.replace(k, v)
    return out


def _usable_until(rule: dict[str, Any], facts: dict[str, Any], now: datetime) -> str | None:
    limits = rule.get("limits") or {}
    game = _as_date(facts.get("game_date"))
    upload = _as_date(facts.get("upload_date")) or now.date()
    if "usable_days_after_game" in limits and game:
        return (game + timedelta(days=int(limits["usable_days_after_game"]))).isoformat()
    if "usable_days_after_upload" in limits:
        return (upload + timedelta(days=int(limits["usable_days_after_upload"]))).isoformat()
    return None


def evaluate_passport(
    rules: Iterable[dict[str, Any]],
    facts: dict[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """
    Returns:
      {
        cells: { use: { region: { verdict, reasons[], usable_until?, max_duration_sec? } } },
        rules_fired: [id...],
        usable_until: earliest across allow_limited cells or None,
        demo_disclaimer: str,
      }
    """
    now = now or datetime.now(timezone.utc)
    today = now.date()

    # Start uncovered (severity -1) so allow/allow_limited can win; uncovered → review at end.
    cells: dict[str, dict[str, dict[str, Any]]] = {
        u: {
            r: {
                "verdict": None,
                "reasons": [],
                "covered": False,
                "usable_until": None,
                "max_duration_sec": None,
            }
            for r in REGIONS
        }
        for u in USES
    }
    rules_fired: list[str] = []

    for rule in rules:
        if not rule_matches(rule, facts):
            continue

        # C-03 / C-04: published edit platform scoping
        when = rule.get("when") or {}
        pub = (facts.get("published_on") or "").lower()
        uses = _expand(rule["uses"])
        if when.get("published_on_matches_use") is True:
            uses = [u for u in uses if u == pub] or uses
        elif when.get("published_on_matches_use") is False:
            uses = [u for u in uses if u != pub]

        regions = _expand_regions(rule["regions"])
        verdict = rule["verdict"]
        reason = {
            "rule_id": rule["id"],
            "verdict": verdict,
            "text": _fill_reason(rule["reason"], facts),
        }
        until = _usable_until(rule, facts, now)
        max_dur = (rule.get("limits") or {}).get("max_duration_sec")

        # Expire allow_limited past usable_until
        effective = verdict
        if until and verdict in ("allow", "allow_limited"):
            if date.fromisoformat(until) < today:
                effective = "block"
                reason = {
                    "rule_id": rule["id"],
                    "verdict": "block",
                    "text": f"Expired ({until}): {reason['text']}",
                }

        rules_fired.append(rule["id"])
        for use in uses:
            if use not in cells:
                continue
            for region in regions:
                cell = cells[use][region]
                cell["covered"] = True
                cur = cell["verdict"]
                if cur is None or severity(effective) > severity(cur):
                    cell["verdict"] = effective
                    cell["reasons"] = [reason]
                    cell["usable_until"] = until if effective in ("allow", "allow_limited") else None
                    cell["max_duration_sec"] = max_dur if effective == "allow_limited" else None
                elif severity(effective) == severity(cur):
                    cell["reasons"].append(reason)
                    if until and effective in ("allow", "allow_limited"):
                        prev = cell.get("usable_until")
                        if prev is None or until < prev:
                            cell["usable_until"] = until

    for use in USES:
        for region in REGIONS:
            cell = cells[use][region]
            if not cell["covered"] or cell["verdict"] is None:
                cell["verdict"] = "review"
                cell["reasons"] = [
                    {
                        "rule_id": "DEFAULT",
                        "verdict": "review",
                        "text": "No rule covers this use/region; check before use (safe default).",
                    }
                ]
            del cell["covered"]

    earliest = None
    for use in USES:
        for region in REGIONS:
            u = cells[use][region].get("usable_until")
            if u and (earliest is None or u < earliest):
                earliest = u

    return {
        "cells": cells,
        "rules_fired": sorted(set(rules_fired)),
        "usable_until": earliest,
        "demo_disclaimer": (
            "SAMPLE RULES — not actual NBA, Premier League, club, broadcaster or sponsor terms; "
            "not legal advice. Verdicts are recommendations a person confirms."
        ),
        "evaluated_at": now.isoformat(),
    }


def overall_verdict(passport: dict[str, Any], *, focus_uses: list[str] | None = None) -> str:
    """Map passport → ALLOWED | BLOCKED | NEEDS_REVIEW for gold.l2_decisions."""
    focus = focus_uses or list(USES)
    worst = "allow"
    for use in focus:
        for region in REGIONS:
            v = passport["cells"][use][region]["verdict"]
            if severity(v) > severity(worst):
                worst = v
    if worst == "block":
        return "BLOCKED"
    if worst in ("review",):
        return "NEEDS_REVIEW"
    return "ALLOWED"


def flatten_rules(packs: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pack in packs:
        for r in pack.get("rules") or []:
            out.append(deepcopy(r))
    return out
