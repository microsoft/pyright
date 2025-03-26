from _typeshed import Incomplete

from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable

@_dispatchable
def closeness_vitality(
    G: Graph[_Node], node: Incomplete | None = None, weight: str | None = None, wiener_index: float | None = None
): ...
