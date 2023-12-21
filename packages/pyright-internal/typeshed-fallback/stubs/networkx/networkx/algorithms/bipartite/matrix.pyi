from _typeshed import Incomplete

def biadjacency_matrix(
    G,
    row_order,
    column_order: Incomplete | None = None,
    dtype: Incomplete | None = None,
    weight: str = "weight",
    format: str = "csr",
): ...
def from_biadjacency_matrix(A, create_using: Incomplete | None = None, edge_attribute: str = "weight"): ...
