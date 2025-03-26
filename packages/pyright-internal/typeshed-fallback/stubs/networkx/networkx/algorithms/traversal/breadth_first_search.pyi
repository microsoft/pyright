from _typeshed import Incomplete
from collections.abc import Callable, Generator

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def bfs_edges(
    G: Graph[_Node],
    source: _Node,
    reverse: bool | None = False,
    depth_limit=None,
    sort_neighbors: Callable[..., Incomplete] | None = None,
) -> Generator[Incomplete, Incomplete, None]: ...
@_dispatchable
def bfs_tree(
    G: Graph[_Node],
    source: _Node,
    reverse: bool | None = False,
    depth_limit=None,
    sort_neighbors: Callable[..., Incomplete] | None = None,
): ...
@_dispatchable
def bfs_predecessors(
    G: Graph[_Node], source: _Node, depth_limit=None, sort_neighbors: Callable[..., Incomplete] | None = None
) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def bfs_successors(
    G: Graph[_Node], source: _Node, depth_limit=None, sort_neighbors: Callable[..., Incomplete] | None = None
) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def bfs_layers(G: Graph[_Node], sources) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def descendants_at_distance(G: Graph[_Node], source, distance): ...
