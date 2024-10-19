from collections.abc import Generator, Hashable

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def is_k_edge_connected(G: Graph[Hashable], k: int): ...
@_dispatchable
def is_locally_k_edge_connected(G, s, t, k): ...
@_dispatchable
def k_edge_augmentation(
    G: Graph[_Node],
    k: int,
    avail: tuple[_Node, _Node] | tuple[_Node, _Node, dict[str, int]] | None = None,
    weight: str | None = None,
    partial: bool = False,
) -> Generator[tuple[_Node, _Node], None, None]: ...
