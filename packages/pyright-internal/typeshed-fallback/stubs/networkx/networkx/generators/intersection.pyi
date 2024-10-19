from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def uniform_random_intersection_graph(n, m, p, seed: Incomplete | None = None): ...
@_dispatchable
def k_random_intersection_graph(n, m, k, seed: Incomplete | None = None): ...
@_dispatchable
def general_random_intersection_graph(n, m, p, seed: Incomplete | None = None): ...
