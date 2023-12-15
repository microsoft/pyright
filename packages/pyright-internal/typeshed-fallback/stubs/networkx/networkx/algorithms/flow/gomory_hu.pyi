from _typeshed import Incomplete

from .edmondskarp import edmonds_karp

__all__ = ["gomory_hu_tree"]

default_flow_func = edmonds_karp

def gomory_hu_tree(G, capacity: str = "capacity", flow_func: Incomplete | None = None): ...
