from _typeshed import Incomplete
from collections.abc import Generator

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def is_eulerian(G: Graph[_Node]): ...
@_dispatchable
def is_semieulerian(G): ...
@_dispatchable
def eulerian_circuit(
    G: Graph[_Node], source: _Node | None = None, keys: bool = False
) -> Generator[Incomplete, Incomplete, None]: ...
@_dispatchable
def has_eulerian_path(G: Graph[_Node], source: _Node | None = None): ...
@_dispatchable
def eulerian_path(G: Graph[_Node], source=None, keys: bool = False) -> Generator[Incomplete, Incomplete, None]: ...
@_dispatchable
def eulerize(G: Graph[_Node]): ...
