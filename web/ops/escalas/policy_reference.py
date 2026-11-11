"""Shared operational references; documentary expiry never creates a closure."""
import json
from pathlib import Path

REFERENCE = json.loads(Path(__file__).with_name("policy-reference.json").read_text(encoding="utf-8"))
TRANSITION_42_DATE = REFERENCE["transition42Date"]
TRANSITION_40_DATE = REFERENCE["transition40Date"]
CCT_PROFILE = REFERENCE["cctProfile"]
CCT_FROM = REFERENCE["cctFrom"]
CCT_UNTIL = REFERENCE["cctUntil"]
