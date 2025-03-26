from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def harmonic_function(G: Graph[_Node], max_iter: int = 30, label_name: str = "label"): ...
@_dispatchable
def local_and_global_consistency(G: Graph[_Node], alpha: float = 0.99, max_iter: int = 30, label_name: str = "label"): ...
