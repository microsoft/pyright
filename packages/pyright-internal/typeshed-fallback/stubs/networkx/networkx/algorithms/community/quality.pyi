from networkx.exception import NetworkXError
from networkx.utils.backends import _dispatchable

__all__ = ["modularity", "partition_quality"]

class NotAPartition(NetworkXError):
    def __init__(self, G, collection) -> None: ...

@_dispatchable
def modularity(G, communities, weight: str = "weight", resolution: float = 1): ...
@_dispatchable
def partition_quality(G, partition): ...
