from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def degree_assortativity_coefficient(
    G, x: str = "out", y: str = "in", weight: Incomplete | None = None, nodes: Incomplete | None = None
): ...
@_dispatchable
def degree_pearson_correlation_coefficient(
    G, x: str = "out", y: str = "in", weight: Incomplete | None = None, nodes: Incomplete | None = None
): ...
@_dispatchable
def attribute_assortativity_coefficient(G, attribute, nodes: Incomplete | None = None): ...
@_dispatchable
def numeric_assortativity_coefficient(G, attribute, nodes: Incomplete | None = None): ...
