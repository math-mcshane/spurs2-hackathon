"""Golden fixtures for irl.group Rights Passport (no Spark / Databricks)."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from policy.engine import evaluate_passport  # noqa: E402
from policy.resolve import load_composed_rules  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "passport"


@pytest.mark.parametrize("name", sorted(p.stem for p in FIXTURES.glob("*.json")))
def test_golden_passport(name: str) -> None:
    fixture = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    club = fixture["facts"].get("club_code")
    rules = load_composed_rules(club)
    now = datetime.fromisoformat(fixture["now"].replace("Z", "+00:00"))
    result = evaluate_passport(rules, fixture["facts"], now=now)
    expect = fixture["expect"]

    for rid in expect.get("rules_fired_contains") or []:
        assert rid in result["rules_fired"], f"{name}: missing rule {rid} in {result['rules_fired']}"

    for use, regions in (expect.get("cells") or {}).items():
        for region, verdict in regions.items():
            got = result["cells"][use][region]["verdict"]
            assert got == verdict, f"{name}: {use}x{region} expected {verdict} got {got}"

    if "usable_until" in expect:
        assert result.get("usable_until") == expect["usable_until"]
