from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def effective_size(G, nodes: Incomplete | None = None, weight: Incomplete | None = None): ...
@_dispatchable
def constraint(G, nodes: Incomplete | None = None, weight: Incomplete | None = None): ...
@_dispatchable
def local_constraint(G, u, v, weight: Incomplete | None = None): ...
