from collections.abc import Iterable

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

__all__ = ["dominating_set", "is_dominating_set"]

@_dispatchable
def dominating_set(G: Graph[_Node], start_with: _Node | None = None): ...
@_dispatchable
def is_dominating_set(G: Graph[_Node], nbunch: Iterable[_Node]) -> bool: ...
