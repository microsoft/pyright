from _typeshed import Incomplete
from collections.abc import Iterable

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def laplacian_centrality(
    G: Graph[_Node],
    normalized: bool = True,
    nodelist: Iterable[Incomplete] | None = None,
    weight: str | None = "weight",
    walk_type: str | None = None,
    alpha: float = 0.95,
): ...
