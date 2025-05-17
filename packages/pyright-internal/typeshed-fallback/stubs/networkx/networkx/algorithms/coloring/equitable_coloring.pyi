from _typeshed import Incomplete, SupportsGetItem
from collections.abc import Mapping
from typing import SupportsIndex

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

__all__ = ["equitable_color"]

@_dispatchable
def is_coloring(G: Graph[_Node], coloring: SupportsGetItem[Incomplete, Incomplete]) -> bool: ...
@_dispatchable
def is_equitable(G: Graph[_Node], coloring: Mapping[Incomplete, Incomplete], num_colors: SupportsIndex | None = None) -> bool: ...
@_dispatchable
def equitable_color(G: Graph[_Node], num_colors): ...
