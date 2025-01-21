from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def latapy_clustering(G, nodes: Incomplete | None = None, mode: str = "dot"): ...

clustering = latapy_clustering

@_dispatchable
def average_clustering(G, nodes: Incomplete | None = None, mode: str = "dot"): ...
@_dispatchable
def robins_alexander_clustering(G): ...
