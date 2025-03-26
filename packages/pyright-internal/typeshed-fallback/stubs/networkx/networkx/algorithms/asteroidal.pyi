from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def find_asteroidal_triple(G: Graph[_Node]): ...
@_dispatchable
def is_at_free(G: Graph[_Node]): ...
