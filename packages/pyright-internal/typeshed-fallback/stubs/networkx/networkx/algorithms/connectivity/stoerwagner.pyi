from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def stoer_wagner(G: Graph[_Node], weight: str = "weight", heap: type = ...): ...
