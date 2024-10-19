from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def biadjacency_matrix(
    G,
    row_order,
    column_order: Incomplete | None = None,
    dtype: Incomplete | None = None,
    weight: str = "weight",
    format: str = "csr",
): ...
@_dispatchable
def from_biadjacency_matrix(A, create_using: Incomplete | None = None, edge_attribute: str = "weight"): ...
