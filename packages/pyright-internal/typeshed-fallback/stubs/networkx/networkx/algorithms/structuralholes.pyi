from _typeshed import Incomplete
from collections.abc import Iterable

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

__all__ = ["constraint", "local_constraint", "effective_size"]

@_dispatchable
def effective_size(G: Graph[_Node], nodes: Iterable[Incomplete] | None = None, weight: str | None = None): ...
@_dispatchable
def constraint(G: Graph[_Node], nodes: Iterable[Incomplete] | None = None, weight: str | None = None): ...
@_dispatchable
def local_constraint(G: Graph[_Node], u: _Node, v: _Node, weight: str | None = None): ...
