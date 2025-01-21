from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def dedensify(G, threshold, prefix: Incomplete | None = None, copy: bool = True): ...
@_dispatchable
def snap_aggregation(
    G,
    node_attributes,
    edge_attributes=(),
    prefix: str = "Supernode-",
    supernode_attribute: str = "group",
    superedge_attribute: str = "types",
): ...
