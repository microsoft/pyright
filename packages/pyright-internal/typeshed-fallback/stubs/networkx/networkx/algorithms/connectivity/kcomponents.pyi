from _typeshed import Incomplete

from networkx.algorithms.flow import edmonds_karp

__all__ = ["k_components"]

default_flow_func = edmonds_karp

def k_components(G, flow_func: Incomplete | None = None): ...
