# This sample tests the handling of Required and NotRequired using
# the alternative syntax form of TypedDict.

from typing import TypedDict
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Required,
    NotRequired,
)

Example1 = TypedDict(
    "Example1", {"required": Required[int], "not_required": NotRequired[int]}
)

v1_0: Example1 = {"required": 1}

# This should generate an error.
v1_1: Example1 = {"not_required": 1}

Example2 = TypedDict("Example2", required=Required[int], not_required=NotRequired[int])


v2_0: Example2 = {"required": 1}

# This should generate an error.
v2_1: Example2 = {"not_required": 1}
