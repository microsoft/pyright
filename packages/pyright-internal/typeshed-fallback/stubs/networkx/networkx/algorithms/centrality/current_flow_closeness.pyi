from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def current_flow_closeness_centrality(G, weight: Incomplete | None = None, dtype=..., solver: str = "lu"): ...

information_centrality = current_flow_closeness_centrality
