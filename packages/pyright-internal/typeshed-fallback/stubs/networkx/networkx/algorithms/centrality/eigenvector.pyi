from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def eigenvector_centrality(
    G, max_iter: int = 100, tol: float = 1e-06, nstart: Incomplete | None = None, weight: Incomplete | None = None
): ...
@_dispatchable
def eigenvector_centrality_numpy(G, weight: Incomplete | None = None, max_iter: int = 50, tol: float = 0): ...
