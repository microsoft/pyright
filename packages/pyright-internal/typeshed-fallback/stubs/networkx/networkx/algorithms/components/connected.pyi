from _typeshed import Incomplete
from collections.abc import Generator

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def connected_components(G: Graph[_Node]) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def number_connected_components(G: Graph[_Node]): ...
@_dispatchable
def is_connected(G: Graph[_Node]): ...
@_dispatchable
def node_connected_component(G: Graph[_Node], n: _Node): ...
