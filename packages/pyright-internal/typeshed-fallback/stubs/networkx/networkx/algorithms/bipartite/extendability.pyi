from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def maximal_extendability(G: Graph[_Node]): ...
