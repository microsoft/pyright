from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def random_reference(G, niter: int = 1, connectivity: bool = True, seed: Incomplete | None = None): ...
@_dispatchable
def lattice_reference(
    G, niter: int = 5, D: Incomplete | None = None, connectivity: bool = True, seed: Incomplete | None = None
): ...
@_dispatchable
def sigma(G, niter: int = 100, nrand: int = 10, seed: Incomplete | None = None): ...
@_dispatchable
def omega(G, niter: int = 5, nrand: int = 10, seed: Incomplete | None = None): ...
