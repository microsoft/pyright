from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def approximate_current_flow_betweenness_centrality(
    G,
    normalized: bool = True,
    weight: Incomplete | None = None,
    dtype=...,
    solver: str = "full",
    epsilon: float = 0.5,
    kmax: int = 10000,
    seed: Incomplete | None = None,
): ...
@_dispatchable
def current_flow_betweenness_centrality(
    G, normalized: bool = True, weight: Incomplete | None = None, dtype=..., solver: str = "full"
): ...
@_dispatchable
def edge_current_flow_betweenness_centrality(
    G, normalized: bool = True, weight: Incomplete | None = None, dtype=..., solver: str = "full"
): ...
