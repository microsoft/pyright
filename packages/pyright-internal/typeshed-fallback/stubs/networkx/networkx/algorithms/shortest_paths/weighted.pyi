from _typeshed import Incomplete, SupportsGetItem
from collections.abc import Callable, Generator
from typing import Any

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def dijkstra_path(
    G: Graph[_Node],
    source: _Node,
    target: _Node,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def dijkstra_path_length(
    G: Graph[_Node],
    source: str,
    target: str,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def single_source_dijkstra_path(
    G: Graph[_Node],
    source: _Node,
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def single_source_dijkstra_path_length(
    G: Graph[_Node],
    source: str,
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def single_source_dijkstra(
    G: Graph[_Node],
    source: str,
    target: str | None = None,
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def multi_source_dijkstra_path(
    G: Graph[_Node],
    sources,
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def multi_source_dijkstra_path_length(
    G: Graph[_Node],
    sources,
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def multi_source_dijkstra(
    G: Graph[_Node],
    sources,
    target: str | None = None,
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def dijkstra_predecessor_and_distance(
    G: Graph[_Node],
    source: str,
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def all_pairs_dijkstra(
    G: Graph[_Node],
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def all_pairs_dijkstra_path_length(
    G: Graph[_Node],
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def all_pairs_dijkstra_path(
    G: Graph[_Node],
    cutoff: float | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def bellman_ford_predecessor_and_distance(
    G: Graph[_Node],
    source: str,
    target: str | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
    heuristic: bool = False,
): ...
@_dispatchable
def bellman_ford_path(
    G: Graph[_Node],
    source: _Node,
    target: _Node,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def bellman_ford_path_length(
    G: Graph[_Node],
    source: str,
    target: str,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def single_source_bellman_ford_path(
    G: Graph[_Node], source: _Node, weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight"
): ...
@_dispatchable
def single_source_bellman_ford_path_length(
    G: Graph[_Node], source: str, weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight"
): ...
@_dispatchable
def single_source_bellman_ford(
    G: Graph[_Node],
    source: str,
    target: str | None = None,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def all_pairs_bellman_ford_path_length(
    G: Graph[_Node], weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight"
) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def all_pairs_bellman_ford_path(
    G: Graph[_Node], weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight"
) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def goldberg_radzik(
    G: Graph[_Node], source: str, weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight"
): ...
@_dispatchable
def negative_edge_cycle(
    G: Graph[_Node],
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
    heuristic: bool = True,
): ...
@_dispatchable
def find_negative_cycle(
    G: Graph[_Node], source: str, weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight"
): ...
@_dispatchable
def bidirectional_dijkstra(
    G: Graph[_Node],
    source: _Node,
    target: _Node,
    weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight",
): ...
@_dispatchable
def johnson(G: Graph[_Node], weight: str | Callable[[Any, Any, SupportsGetItem[str, Any]], float | None] | None = "weight"): ...
