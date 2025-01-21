from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

__all__ = ["load_centrality", "edge_load_centrality"]

@_dispatchable
def newman_betweenness_centrality(
    G, v: Incomplete | None = None, cutoff: Incomplete | None = None, normalized: bool = True, weight: Incomplete | None = None
): ...

load_centrality = newman_betweenness_centrality

@_dispatchable
def edge_load_centrality(G, cutoff: bool = False): ...
