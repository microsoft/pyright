from _typeshed import Incomplete
from collections.abc import Iterable

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def latapy_clustering(G: Graph[_Node], nodes: Iterable[Incomplete] | None = None, mode: str = "dot"): ...

clustering = latapy_clustering

@_dispatchable
def average_clustering(G: Graph[_Node], nodes: Iterable[Incomplete] | None = None, mode: str = "dot"): ...
@_dispatchable
def robins_alexander_clustering(G: Graph[_Node]): ...
