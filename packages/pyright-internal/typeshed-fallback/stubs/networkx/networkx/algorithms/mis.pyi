from _typeshed import Incomplete
from collections.abc import Iterable

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable
from numpy.random import RandomState

@_dispatchable
def maximal_independent_set(
    G: Graph[_Node], nodes: Iterable[Incomplete] | None = None, seed: int | RandomState | None = None
): ...
