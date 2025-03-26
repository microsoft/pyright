from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable
from numpy.random import RandomState

@_dispatchable
def spanner(G: Graph[_Node], stretch: float, weight: str | None = None, seed: int | RandomState | None = None): ...
