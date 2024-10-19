from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def attribute_mixing_dict(G, attribute, nodes: Incomplete | None = None, normalized: bool = False): ...
@_dispatchable
def attribute_mixing_matrix(
    G, attribute, nodes: Incomplete | None = None, mapping: Incomplete | None = None, normalized: bool = True
): ...
@_dispatchable
def degree_mixing_dict(
    G, x: str = "out", y: str = "in", weight: Incomplete | None = None, nodes: Incomplete | None = None, normalized: bool = False
): ...
@_dispatchable
def degree_mixing_matrix(
    G,
    x: str = "out",
    y: str = "in",
    weight: Incomplete | None = None,
    nodes: Incomplete | None = None,
    normalized: bool = True,
    mapping: Incomplete | None = None,
): ...
@_dispatchable
def mixing_dict(xy, normalized: bool = False): ...
