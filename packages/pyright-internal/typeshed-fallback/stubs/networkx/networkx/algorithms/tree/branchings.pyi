from _typeshed import Incomplete
from collections.abc import Iterator
from dataclasses import dataclass

from networkx.utils.backends import _dispatchable

__all__ = [
    "branching_weight",
    "greedy_branching",
    "maximum_branching",
    "minimum_branching",
    "maximum_spanning_arborescence",
    "minimum_spanning_arborescence",
    "ArborescenceIterator",
]

@_dispatchable
def branching_weight(G, attr: str = "weight", default: float = 1): ...
@_dispatchable
def greedy_branching(G, attr: str = "weight", default: float = 1, kind: str = "max", seed: Incomplete | None = None): ...
@_dispatchable
def maximum_branching(
    G, attr: str = "weight", default: float = 1, preserve_attrs: bool = False, partition: Incomplete | None = None
): ...
@_dispatchable
def minimum_branching(
    G, attr: str = "weight", default: float = 1, preserve_attrs: bool = False, partition: Incomplete | None = None
): ...
@_dispatchable
def maximum_spanning_arborescence(
    G, attr: str = "weight", default: float = 1, preserve_attrs: bool = False, partition: Incomplete | None = None
): ...
@_dispatchable
def minimum_spanning_arborescence(
    G, attr: str = "weight", default: float = 1, preserve_attrs: bool = False, partition: Incomplete | None = None
): ...

class ArborescenceIterator:
    @dataclass
    class Partition:
        mst_weight: float
        partition_dict: dict[Incomplete, Incomplete]

    G: Incomplete
    weight: Incomplete
    minimum: Incomplete
    method: Incomplete
    partition_key: str
    init_partition: Incomplete
    def __init__(self, G, weight: str = "weight", minimum: bool = True, init_partition: Incomplete | None = None) -> None: ...
    partition_queue: Incomplete
    def __iter__(self) -> Iterator[Incomplete]: ...
    def __next__(self): ...
