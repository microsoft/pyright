from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def astar_path(G, source, target, heuristic: Incomplete | None = None, weight: str = "weight"): ...
@_dispatchable
def astar_path_length(G, source, target, heuristic: Incomplete | None = None, weight: str = "weight"): ...
