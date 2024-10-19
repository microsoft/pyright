from collections.abc import Hashable
from typing import TypeVar

from networkx.classes.digraph import DiGraph
from networkx.utils.backends import _dispatchable

@_dispatchable
def disjoint_union(G, H): ...
@_dispatchable
def intersection(G, H): ...
@_dispatchable
def difference(G, H): ...
@_dispatchable
def symmetric_difference(G, H): ...

_X = TypeVar("_X", bound=Hashable, covariant=True)
_Y = TypeVar("_Y", bound=Hashable, covariant=True)
# GT = TypeVar('GT', bound=Graph[_Node])
# TODO: This does not handle the cases when graphs of different types are passed which is allowed

@_dispatchable
def compose(G: DiGraph[_X], H: DiGraph[_Y]) -> DiGraph[_X | _Y]: ...
@_dispatchable
def union(G: DiGraph[_X], H: DiGraph[_Y], rename=()) -> DiGraph[_X | _Y]: ...
