from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def spectral_bipartivity(G: Graph[_Node], nodes=None, weight: str = "weight"): ...
