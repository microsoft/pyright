from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def k_components(G: Graph[_Node], min_density: float = 0.95): ...
