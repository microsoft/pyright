from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def min_weighted_dominating_set(G: Graph[_Node], weight: str | None = None): ...
@_dispatchable
def min_edge_dominating_set(G: Graph[_Node]): ...
