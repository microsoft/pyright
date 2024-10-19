from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

from .edmondskarp import edmonds_karp

__all__ = ["gomory_hu_tree"]

default_flow_func = edmonds_karp

@_dispatchable
def gomory_hu_tree(G, capacity: str = "capacity", flow_func: Incomplete | None = None): ...
