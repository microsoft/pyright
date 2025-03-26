from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def lukes_partitioning(G: Graph[_Node], max_size: int, node_weight=None, edge_weight=None): ...
