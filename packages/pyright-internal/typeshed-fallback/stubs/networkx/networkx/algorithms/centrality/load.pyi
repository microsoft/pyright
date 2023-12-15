from _typeshed import Incomplete

__all__ = ["load_centrality", "edge_load_centrality"]

def newman_betweenness_centrality(
    G, v: Incomplete | None = None, cutoff: Incomplete | None = None, normalized: bool = True, weight: Incomplete | None = None
): ...

load_centrality = newman_betweenness_centrality

def edge_load_centrality(G, cutoff: bool = False): ...
