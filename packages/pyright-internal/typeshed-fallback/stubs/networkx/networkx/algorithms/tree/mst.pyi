from _typeshed import Incomplete
from collections.abc import Iterator
from dataclasses import dataclass
from enum import Enum

from networkx.utils.backends import _dispatchable

class EdgePartition(Enum):
    OPEN = 0
    INCLUDED = 1
    EXCLUDED = 2

@_dispatchable
def minimum_spanning_edges(
    G, algorithm: str = "kruskal", weight: str = "weight", keys: bool = True, data: bool = True, ignore_nan: bool = False
): ...
@_dispatchable
def maximum_spanning_edges(
    G, algorithm: str = "kruskal", weight: str = "weight", keys: bool = True, data: bool = True, ignore_nan: bool = False
): ...
@_dispatchable
def minimum_spanning_tree(G, weight: str = "weight", algorithm: str = "kruskal", ignore_nan: bool = False): ...
@_dispatchable
def partition_spanning_tree(
    G, minimum: bool = True, weight: str = "weight", partition: str = "partition", ignore_nan: bool = False
): ...
@_dispatchable
def maximum_spanning_tree(G, weight: str = "weight", algorithm: str = "kruskal", ignore_nan: bool = False): ...
@_dispatchable
def random_spanning_tree(G, weight: Incomplete | None = None, *, multiplicative: bool = True, seed: Incomplete | None = None): ...

class SpanningTreeIterator:
    @dataclass
    class Partition:
        mst_weight: float
        partition_dict: dict[Incomplete, Incomplete]

    G: Incomplete
    weight: Incomplete
    minimum: Incomplete
    ignore_nan: Incomplete
    partition_key: str
    def __init__(self, G, weight: str = "weight", minimum: bool = True, ignore_nan: bool = False) -> None: ...
    partition_queue: Incomplete
    def __iter__(self) -> Iterator[Incomplete]: ...
    def __next__(self): ...
