from _typeshed import Incomplete
from collections.abc import Callable

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

__all__ = ["could_be_isomorphic", "fast_could_be_isomorphic", "faster_could_be_isomorphic", "is_isomorphic"]

@_dispatchable
def could_be_isomorphic(G1: Graph[_Node], G2: Graph[_Node]): ...

graph_could_be_isomorphic = could_be_isomorphic

@_dispatchable
def fast_could_be_isomorphic(G1: Graph[_Node], G2: Graph[_Node]): ...

fast_graph_could_be_isomorphic = fast_could_be_isomorphic

@_dispatchable
def faster_could_be_isomorphic(G1: Graph[_Node], G2: Graph[_Node]): ...

faster_graph_could_be_isomorphic = faster_could_be_isomorphic

@_dispatchable
def is_isomorphic(
    G1: Graph[_Node],
    G2: Graph[_Node],
    node_match: Callable[..., Incomplete] | None = None,
    edge_match: Callable[..., Incomplete] | None = None,
): ...
