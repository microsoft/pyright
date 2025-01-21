from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def average_degree_connectivity(
    G, source: str = "in+out", target: str = "in+out", nodes: Incomplete | None = None, weight: Incomplete | None = None
): ...
