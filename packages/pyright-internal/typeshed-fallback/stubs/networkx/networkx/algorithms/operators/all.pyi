from _typeshed import Incomplete
from collections.abc import Iterable
from typing import Any, TypeVar

from networkx.classes.graph import Graph
from networkx.utils.backends import _dispatchable

__all__ = ["union_all", "compose_all", "disjoint_union_all", "intersection_all"]

_G = TypeVar("_G", bound=Graph[Any, Any, Any])

@_dispatchable
def union_all(graphs: Iterable[Incomplete], rename: Iterable[Incomplete] | None = ()) -> Graph[Incomplete]: ...
@_dispatchable
def disjoint_union_all(graphs: Iterable[Incomplete]) -> Graph[Incomplete]: ...
@_dispatchable
def compose_all(graphs: Iterable[_G]) -> _G: ...
@_dispatchable
def intersection_all(graphs: Iterable[Incomplete]) -> Graph[Incomplete]: ...
