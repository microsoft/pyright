from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def ramsey_R2(G: Graph[_Node]): ...
