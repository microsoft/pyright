from collections.abc import Hashable
from typing import TypeVar

from networkx.classes.graph import Graph

_G = TypeVar("_G", bound=Graph[Hashable])

def complement(G): ...
def reverse(G: _G, copy: bool = True) -> _G: ...
