from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def equitable_color(G: Graph[_Node], num_colors): ...
