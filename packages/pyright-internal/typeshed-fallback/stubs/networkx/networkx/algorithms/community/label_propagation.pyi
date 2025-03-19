from _typeshed import Incomplete
from collections.abc import Generator

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable
from numpy.random import RandomState

@_dispatchable
def asyn_lpa_communities(
    G: Graph[_Node], weight: str | None = None, seed: int | RandomState | None = None
) -> Generator[Incomplete, Incomplete, None]: ...
@_dispatchable
def label_propagation_communities(G: Graph[_Node]): ...
