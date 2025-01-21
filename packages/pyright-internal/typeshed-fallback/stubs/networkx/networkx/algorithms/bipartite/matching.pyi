from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def hopcroft_karp_matching(G, top_nodes: Incomplete | None = None): ...
@_dispatchable
def eppstein_matching(G, top_nodes: Incomplete | None = None): ...
@_dispatchable
def to_vertex_cover(G, matching, top_nodes: Incomplete | None = None): ...

maximum_matching = hopcroft_karp_matching

@_dispatchable
def minimum_weight_full_matching(G, top_nodes: Incomplete | None = None, weight: str = "weight"): ...
