from _typeshed import SupportsGetItem
from collections.abc import Generator

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def is_k_edge_connected(G: Graph[_Node], k: int): ...
@_dispatchable
def is_locally_k_edge_connected(G: Graph[_Node], s: _Node, t: _Node, k: int): ...
@_dispatchable
def k_edge_augmentation(
    G: Graph[_Node],
    k: int,
    avail: set[tuple[int, int]] | set[tuple[int, int, float]] | SupportsGetItem[tuple[int, int], float] | None = None,
    weight: str | None = None,
    partial: bool = False,
) -> Generator[tuple[_Node, _Node], None, None]: ...
