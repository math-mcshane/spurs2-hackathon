"""Rights Passport policy IR — pure Python (no Spark). Used by L2 notebooks + local tests."""

from .engine import USES, REGIONS, evaluate_passport, severity
from .resolve import compose_pack_ids_for_club, fallback_l1_tokens

__all__ = [
    "USES",
    "REGIONS",
    "evaluate_passport",
    "severity",
    "compose_pack_ids_for_club",
    "fallback_l1_tokens",
]
