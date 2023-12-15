from _typeshed import Incomplete

def dedensify(G, threshold, prefix: Incomplete | None = None, copy: bool = True): ...
def snap_aggregation(
    G,
    node_attributes,
    edge_attributes=(),
    prefix: str = "Supernode-",
    supernode_attribute: str = "group",
    superedge_attribute: str = "types",
): ...
