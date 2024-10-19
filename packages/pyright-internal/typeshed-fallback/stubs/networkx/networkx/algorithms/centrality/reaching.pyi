from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def global_reaching_centrality(G, weight: Incomplete | None = None, normalized: bool = True): ...
@_dispatchable
def local_reaching_centrality(
    G, v, paths: Incomplete | None = None, weight: Incomplete | None = None, normalized: bool = True
): ...
