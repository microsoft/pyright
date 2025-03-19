from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def voterank(G: Graph[_Node], number_of_nodes: int | None = None): ...
