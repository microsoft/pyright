from _typeshed import Incomplete

def attribute_mixing_dict(G, attribute, nodes: Incomplete | None = None, normalized: bool = False): ...
def attribute_mixing_matrix(
    G, attribute, nodes: Incomplete | None = None, mapping: Incomplete | None = None, normalized: bool = True
): ...
def degree_mixing_dict(
    G, x: str = "out", y: str = "in", weight: Incomplete | None = None, nodes: Incomplete | None = None, normalized: bool = False
): ...
def degree_mixing_matrix(
    G,
    x: str = "out",
    y: str = "in",
    weight: Incomplete | None = None,
    nodes: Incomplete | None = None,
    normalized: bool = True,
    mapping: Incomplete | None = None,
): ...
def mixing_dict(xy, normalized: bool = False): ...
