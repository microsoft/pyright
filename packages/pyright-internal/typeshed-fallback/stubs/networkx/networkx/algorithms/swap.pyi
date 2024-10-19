from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def directed_edge_swap(G, *, nswap: int = 1, max_tries: int = 100, seed: Incomplete | None = None): ...
@_dispatchable
def double_edge_swap(G, nswap: int = 1, max_tries: int = 100, seed: Incomplete | None = None): ...
@_dispatchable
def connected_double_edge_swap(G, nswap: int = 1, _window_threshold: int = 3, seed: Incomplete | None = None): ...
