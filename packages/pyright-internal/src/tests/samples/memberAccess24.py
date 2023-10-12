# This sample tests the case where an attribute is accessed from a
# class that derives from an unknown type or Any.

from typing import Any
from dummy import UnknownX  # type: ignore


class DerivesFromUnknown(UnknownX):
    pass


class DerivesFromAny(Any):
    pass


v1 = DerivesFromUnknown().x
reveal_type(v1, expected_text="Unknown")

v2 = DerivesFromAny().x
reveal_type(v2, expected_text="Any")
