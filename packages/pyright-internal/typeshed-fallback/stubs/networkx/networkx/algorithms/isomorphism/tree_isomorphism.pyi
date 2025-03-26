from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def rooted_tree_isomorphism(t1, root1, t2, root2): ...
@_dispatchable
def tree_isomorphism(t1: Graph[_Node], t2: Graph[_Node]): ...
