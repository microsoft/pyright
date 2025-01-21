from _typeshed import Incomplete

from networkx.algorithms.flow import edmonds_karp
from networkx.utils.backends import _dispatchable

__all__ = [
    "average_node_connectivity",
    "local_node_connectivity",
    "node_connectivity",
    "local_edge_connectivity",
    "edge_connectivity",
    "all_pairs_node_connectivity",
]

default_flow_func = edmonds_karp

@_dispatchable
def local_node_connectivity(
    G,
    s,
    t,
    flow_func: Incomplete | None = None,
    auxiliary: Incomplete | None = None,
    residual: Incomplete | None = None,
    cutoff: Incomplete | None = None,
): ...
@_dispatchable
def node_connectivity(G, s: Incomplete | None = None, t: Incomplete | None = None, flow_func: Incomplete | None = None): ...
@_dispatchable
def average_node_connectivity(G, flow_func: Incomplete | None = None): ...
@_dispatchable
def all_pairs_node_connectivity(G, nbunch: Incomplete | None = None, flow_func: Incomplete | None = None): ...
@_dispatchable
def local_edge_connectivity(
    G,
    s,
    t,
    flow_func: Incomplete | None = None,
    auxiliary: Incomplete | None = None,
    residual: Incomplete | None = None,
    cutoff: Incomplete | None = None,
): ...
@_dispatchable
def edge_connectivity(
    G,
    s: Incomplete | None = None,
    t: Incomplete | None = None,
    flow_func: Incomplete | None = None,
    cutoff: Incomplete | None = None,
): ...
