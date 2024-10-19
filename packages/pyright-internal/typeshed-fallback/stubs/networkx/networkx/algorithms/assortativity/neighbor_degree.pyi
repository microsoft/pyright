from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def average_neighbor_degree(
    G, source: str = "out", target: str = "out", nodes: Incomplete | None = None, weight: Incomplete | None = None
): ...
