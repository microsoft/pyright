from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def communicability(G: Graph[_Node]): ...
@_dispatchable
def communicability_exp(G: Graph[_Node]): ...
