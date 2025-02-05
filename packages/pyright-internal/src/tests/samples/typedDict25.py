# This sample tests that member accesses to a TypedDict are properly
# handled even if one of the items in the TypedDict shadows the name
# of a TypedDict attribute.

from typing import TypedDict


class TD1(TypedDict):
    items: int


td1 = TD1(items=0)
td1.items()
