from _typeshed import Incomplete
from collections.abc import Iterator
from dataclasses import dataclass
from enum import Enum
from typing import Literal

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable
from numpy.random import RandomState

__all__ = [
    "minimum_spanning_edges",
    "maximum_spanning_edges",
    "minimum_spanning_tree",
    "maximum_spanning_tree",
    "number_of_spanning_trees",
    "random_spanning_tree",
    "partition_spanning_tree",
    "EdgePartition",
    "SpanningTreeIterator",
]

class EdgePartition(Enum):
    OPEN = 0
    INCLUDED = 1
    EXCLUDED = 2

@_dispatchable
def minimum_spanning_edges(
    G: Graph[_Node],
    algorithm: str = "kruskal",
    weight: str = "weight",
    keys: bool = True,
    data: bool | None = True,
    ignore_nan: bool = False,
): ...
@_dispatchable
def maximum_spanning_edges(
    G: Graph[_Node],
    algorithm: str = "kruskal",
    weight: str = "weight",
    keys: bool = True,
    data: bool | None = True,
    ignore_nan: bool = False,
): ...
@_dispatchable
def minimum_spanning_tree(G: Graph[_Node], weight: str = "weight", algorithm: str = "kruskal", ignore_nan: bool = False): ...
@_dispatchable
def partition_spanning_tree(
    G: Graph[_Node], minimum: bool = True, weight: str = "weight", partition: str = "partition", ignore_nan: bool = False
): ...
@_dispatchable
def maximum_spanning_tree(G: Graph[_Node], weight: str = "weight", algorithm: str = "kruskal", ignore_nan: bool = False): ...
@_dispatchable
def random_spanning_tree(
    G: Graph[_Node], weight: str | None = None, *, multiplicative=True, seed: int | RandomState | None = None
): ...

class SpanningTreeIterator:
    @dataclass(order=True)
    class Partition:
        mst_weight: float
        partition_dict: dict[Incomplete, Incomplete]
        def __copy__(self) -> SpanningTreeIterator.Partition: ...

    G: Incomplete
    weight: Incomplete
    minimum: Incomplete
    ignore_nan: Incomplete
    partition_key: str

    def __init__(self, G, weight: str = "weight", minimum: bool = True, ignore_nan: bool = False) -> None: ...
    partition_queue: Incomplete

    def __iter__(self) -> Iterator[Incomplete]: ...
    def __next__(self): ...

@_dispatchable
def number_of_spanning_trees(G, *, root=None, weight=None) -> float | Literal[0]: ...
