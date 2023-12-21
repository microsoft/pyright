from _typeshed import Incomplete
from collections.abc import Hashable, Mapping
from typing import TypeVar, overload
from typing_extensions import Literal

from networkx.classes.digraph import DiGraph
from networkx.classes.graph import Graph
from networkx.classes.multidigraph import MultiDiGraph
from networkx.classes.multigraph import MultiGraph

_X = TypeVar("_X", bound=Hashable)
_Y = TypeVar("_Y", bound=Hashable)

@overload
def relabel_nodes(G: MultiDiGraph[_X], mapping: Mapping[_X, _Y], copy: bool = True) -> MultiDiGraph[_X | _Y]: ...
@overload
def relabel_nodes(G: DiGraph[_X], mapping: Mapping[_X, _Y], copy: bool = True) -> DiGraph[_X | _Y]: ...
@overload
def relabel_nodes(G: MultiGraph[_X], mapping: Mapping[_X, _Y], copy: bool = True) -> MultiGraph[_X | _Y]: ...
@overload
def relabel_nodes(G: Graph[_X], mapping: Mapping[_X, _Y], copy: bool = True) -> Graph[_X | _Y]: ...
def convert_node_labels_to_integers(
    G: Graph[Hashable],
    first_label: int = 0,
    ordering: Literal["default", "sorted", "increasing degree", "decreasing degree"] = "default",
    label_attribute: Incomplete | None = None,
) -> Graph[int]: ...
