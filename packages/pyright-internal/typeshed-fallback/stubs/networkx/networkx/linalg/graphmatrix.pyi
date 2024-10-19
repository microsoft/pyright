from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def incidence_matrix(
    G,
    nodelist: Incomplete | None = None,
    edgelist: Incomplete | None = None,
    oriented: bool = False,
    weight: Incomplete | None = None,
): ...
@_dispatchable
def adjacency_matrix(G, nodelist: Incomplete | None = None, dtype: Incomplete | None = None, weight: str = "weight"): ...
