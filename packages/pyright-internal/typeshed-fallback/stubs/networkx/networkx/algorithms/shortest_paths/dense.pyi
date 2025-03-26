from _typeshed import Incomplete, SupportsGetItem
from collections.abc import Iterable

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def floyd_warshall_numpy(G: Graph[_Node], nodelist: Iterable[Incomplete] | None = None, weight: str | None = "weight"): ...
@_dispatchable
def floyd_warshall_predecessor_and_distance(G: Graph[_Node], weight: str | None = "weight"): ...
@_dispatchable
def reconstruct_path(source: _Node, target: _Node, predecessors: SupportsGetItem[Incomplete, Incomplete]): ...
@_dispatchable
def floyd_warshall(G: Graph[_Node], weight: str | None = "weight"): ...
