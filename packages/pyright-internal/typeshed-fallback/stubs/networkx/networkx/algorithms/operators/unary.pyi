from collections.abc import Hashable
from typing import TypeVar

from networkx.classes.graph import Graph
from networkx.utils.backends import _dispatchable

_G = TypeVar("_G", bound=Graph[Hashable])

@_dispatchable
def complement(G): ...
@_dispatchable
def reverse(G: _G, copy: bool = True) -> _G: ...
