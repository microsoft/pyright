from _typeshed import Incomplete
from collections.abc import Generator
from typing import overload

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def has_path(G: Graph[_Node], source: _Node, target: _Node) -> bool: ...
@overload
def shortest_path(
    G: Graph[_Node], source: _Node, target: _Node, weight: Incomplete | None = None, method: str = "dijkstra"
) -> list[_Node]: ...
@overload
def shortest_path(G: Graph[_Node], target: _Node, method: str = "dijkstra") -> dict[_Node, list[_Node]]: ...
@overload
def shortest_path(G: Graph[_Node], source: _Node, method: str = "dijkstra") -> dict[_Node, list[_Node]]: ...
@_dispatchable
def shortest_path_length(
    G,
    source: Incomplete | None = None,
    target: Incomplete | None = None,
    weight: Incomplete | None = None,
    method: str = "dijkstra",
): ...
@_dispatchable
def average_shortest_path_length(G, weight: Incomplete | None = None, method: str | None = None): ...
@_dispatchable
def all_shortest_paths(
    G: Graph[_Node], source: _Node, target: _Node, weight: Incomplete | None = None, method: str = "dijkstra"
) -> Generator[list[_Node], None, None]: ...
