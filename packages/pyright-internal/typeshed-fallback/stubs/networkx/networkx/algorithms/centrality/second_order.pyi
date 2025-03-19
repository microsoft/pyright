from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def second_order_centrality(G: Graph[_Node], weight: str | None = "weight"): ...
