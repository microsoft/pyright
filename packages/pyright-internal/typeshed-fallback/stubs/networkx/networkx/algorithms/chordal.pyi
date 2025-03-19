import sys
from collections.abc import Generator

from networkx.classes.graph import Graph, _Node
from networkx.exception import NetworkXException
from networkx.utils.backends import _dispatchable

class NetworkXTreewidthBoundExceeded(NetworkXException): ...

@_dispatchable
def is_chordal(G: Graph[_Node]) -> bool: ...
@_dispatchable
def find_induced_nodes(G: Graph[_Node], s: _Node, t: _Node, treewidth_bound: float = sys.maxsize) -> set[_Node]: ...
@_dispatchable
def chordal_graph_cliques(G: Graph[_Node]) -> Generator[frozenset[_Node], None, None]: ...
@_dispatchable
def chordal_graph_treewidth(G: Graph[_Node]) -> int: ...
