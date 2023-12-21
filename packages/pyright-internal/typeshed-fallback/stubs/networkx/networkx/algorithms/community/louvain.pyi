from _typeshed import Incomplete
from collections.abc import Generator

def louvain_communities(
    G, weight: str = "weight", resolution: float = 1, threshold: float = 1e-07, seed: Incomplete | None = None
): ...
def louvain_partitions(
    G, weight: str = "weight", resolution: float = 1, threshold: float = 1e-07, seed: Incomplete | None = None
) -> Generator[Incomplete, None, None]: ...
