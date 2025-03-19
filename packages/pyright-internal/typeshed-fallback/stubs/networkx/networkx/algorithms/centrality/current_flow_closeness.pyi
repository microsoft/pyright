from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def current_flow_closeness_centrality(G: Graph[_Node], weight: str | None = None, dtype: type = ..., solver: str = "lu"): ...

information_centrality = current_flow_closeness_centrality
