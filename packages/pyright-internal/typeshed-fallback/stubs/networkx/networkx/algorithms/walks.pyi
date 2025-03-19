from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def number_of_walks(G: Graph[_Node], walk_length: int): ...
