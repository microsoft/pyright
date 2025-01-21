from _typeshed import Incomplete
from collections.abc import Generator

from networkx.utils.backends import _dispatchable

@_dispatchable
def bfs_edges(
    G, source, reverse: bool = False, depth_limit: Incomplete | None = None, sort_neighbors: Incomplete | None = None
) -> Generator[Incomplete, Incomplete, None]: ...
@_dispatchable
def bfs_tree(
    G, source, reverse: bool = False, depth_limit: Incomplete | None = None, sort_neighbors: Incomplete | None = None
): ...
@_dispatchable
def bfs_predecessors(
    G, source, depth_limit: Incomplete | None = None, sort_neighbors: Incomplete | None = None
) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def bfs_successors(
    G, source, depth_limit: Incomplete | None = None, sort_neighbors: Incomplete | None = None
) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def bfs_layers(G, sources) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def descendants_at_distance(G, source, distance): ...
