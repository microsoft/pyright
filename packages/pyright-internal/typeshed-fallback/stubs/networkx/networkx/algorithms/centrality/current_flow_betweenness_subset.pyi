from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def current_flow_betweenness_centrality_subset(
    G, sources, targets, normalized: bool = True, weight: Incomplete | None = None, dtype=..., solver: str = "lu"
): ...
@_dispatchable
def edge_current_flow_betweenness_centrality_subset(
    G, sources, targets, normalized: bool = True, weight: Incomplete | None = None, dtype=..., solver: str = "lu"
): ...
