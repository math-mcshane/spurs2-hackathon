"""Active pack composition + filesystem loaders (no Spark)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

PACKS_DIR = Path(__file__).resolve().parent / "packs"

FALLBACK_L1_TOKENS = (
    "nsfw",
    "nude",
    "nudity",
    "gore",
    "graphic_violence",
    "hate_symbol",
    "drug_use",
    "csam",
)


def fallback_l1_tokens() -> tuple[str, ...]:
    return FALLBACK_L1_TOKENS


def compose_pack_ids_for_club(club_code: str | None) -> list[str]:
    """Ordered L2 pack_ids to compose for a club (latest activated version of each)."""
    club = (club_code or "").upper()
    base = [
        "l2-passport-g-common",
        "l2-passport-c-club",
        "l2-passport-f-fan",
    ]
    if club == "SAS":
        base.append("l2-passport-n-spurs")
        base.append("l2-advertiser-nike-sas")
    elif club == "TOT":
        base.append("l2-passport-p-tottenham")
        base.append("l2-advertiser-nike-tot")
    else:
        # Both league packs if club unknown — rules are club_code-gated
        base.extend(["l2-passport-n-spurs", "l2-passport-p-tottenham"])
    return base


def load_pack_file(pack_id: str, version: str | None = None) -> dict[str, Any]:
    path = PACKS_DIR / f"{pack_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Pack file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if version and data.get("version") != version:
        raise ValueError(f"Pack {pack_id} file version {data.get('version')} != {version}")
    return data


def load_all_local_packs() -> list[dict[str, Any]]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(PACKS_DIR.glob("*.json"))]


def load_composed_rules(club_code: str | None) -> list[dict[str, Any]]:
    from .engine import flatten_rules

    packs = []
    for pid in compose_pack_ids_for_club(club_code):
        path = PACKS_DIR / f"{pid}.json"
        if path.exists():
            packs.append(json.loads(path.read_text(encoding="utf-8")))
    return flatten_rules(packs)


def l1_tokens_from_pack(pack: dict[str, Any] | None) -> tuple[str, ...]:
    if not pack:
        return FALLBACK_L1_TOKENS
    tokens = pack.get("reject_tokens")
    if isinstance(tokens, list) and tokens:
        return tuple(str(t).lower() for t in tokens)
    return FALLBACK_L1_TOKENS
