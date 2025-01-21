from _typeshed import Incomplete

from networkx.algorithms.flow import edmonds_karp
from networkx.utils.backends import _dispatchable

__all__ = ["k_components"]

default_flow_func = edmonds_karp

@_dispatchable
def k_components(G, flow_func: Incomplete | None = None): ...
