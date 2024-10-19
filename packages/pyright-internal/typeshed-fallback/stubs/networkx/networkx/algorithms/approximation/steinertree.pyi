from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def metric_closure(G, weight: str = "weight"): ...
@_dispatchable
def steiner_tree(G, terminal_nodes, weight: str = "weight", method: Incomplete | None = None): ...
