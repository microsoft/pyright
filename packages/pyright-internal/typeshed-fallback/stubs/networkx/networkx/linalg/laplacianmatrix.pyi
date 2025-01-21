from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def laplacian_matrix(G, nodelist: Incomplete | None = None, weight: str = "weight"): ...
@_dispatchable
def normalized_laplacian_matrix(G, nodelist: Incomplete | None = None, weight: str = "weight"): ...
@_dispatchable
def total_spanning_tree_weight(G, weight: Incomplete | None = None): ...
@_dispatchable
def directed_laplacian_matrix(
    G, nodelist: Incomplete | None = None, weight: str = "weight", walk_type: Incomplete | None = None, alpha: float = 0.95
): ...
@_dispatchable
def directed_combinatorial_laplacian_matrix(
    G, nodelist: Incomplete | None = None, weight: str = "weight", walk_type: Incomplete | None = None, alpha: float = 0.95
): ...
