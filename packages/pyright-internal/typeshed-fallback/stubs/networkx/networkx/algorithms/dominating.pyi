from _typeshed import Incomplete
from collections.abc import Iterable

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def dominating_set(G: Graph[_Node], start_with: _Node | None = None): ...
@_dispatchable
def is_dominating_set(G: Graph[_Node], nbunch: Iterable[Incomplete]): ...
