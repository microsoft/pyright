from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def wiener_index(G: Graph[_Node], weight: str | None = None): ...
