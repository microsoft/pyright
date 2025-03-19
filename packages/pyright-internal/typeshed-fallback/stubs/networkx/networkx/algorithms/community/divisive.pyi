from _typeshed import Incomplete

import networkx as nx
from networkx.classes.graph import Graph, _Node

__all__ = ["edge_betweenness_partition", "edge_current_flow_betweenness_partition"]

@nx._dispatchable
def edge_betweenness_partition(G: Graph[_Node], number_of_sets: int, *, weight: str | None = None) -> list[Incomplete]: ...
@nx._dispatchable
def edge_current_flow_betweenness_partition(
    G: Graph[_Node], number_of_sets: int, *, weight: str | None = None
) -> list[Incomplete]: ...
