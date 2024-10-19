from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def group_betweenness_centrality(G, C, normalized: bool = True, weight: Incomplete | None = None, endpoints: bool = False): ...
@_dispatchable
def prominent_group(
    G,
    k,
    weight: Incomplete | None = None,
    C: Incomplete | None = None,
    endpoints: bool = False,
    normalized: bool = True,
    greedy: bool = False,
): ...
@_dispatchable
def group_closeness_centrality(G, S, weight: Incomplete | None = None): ...
@_dispatchable
def group_degree_centrality(G, S): ...
@_dispatchable
def group_in_degree_centrality(G, S): ...
@_dispatchable
def group_out_degree_centrality(G, S): ...
