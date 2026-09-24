# This sample verifies that conditional TypedDict fields are recomputed for each configuration.

import sys
from typing import TypedDict

FEATURE_SET = "legacy"


class ConfiguredFields(TypedDict):
    if FEATURE_SET == "modern":
        configured: str
    else:
        legacy_configured: bytes


class VersionFields(TypedDict):
    if sys.version_info >= (3, 13):
        versioned: str
    else:
        legacy_versioned: bytes


class PlatformFields(TypedDict):
    if sys.platform == "linux":
        platform: str
    else:
        legacy_platform: bytes


ConfiguredFields(configured="")
VersionFields(versioned="")
PlatformFields(platform="")
