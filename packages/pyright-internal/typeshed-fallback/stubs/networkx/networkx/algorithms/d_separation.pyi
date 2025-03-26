from networkx.classes.digraph import DiGraph
from networkx.classes.graph import _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def d_separated(G, x, y, z): ...
@_dispatchable
def minimal_d_separator(G, u, v): ...
@_dispatchable
def is_minimal_d_separator(G: DiGraph[_Node], x, y, z, *, included=None, restricted=None): ...
