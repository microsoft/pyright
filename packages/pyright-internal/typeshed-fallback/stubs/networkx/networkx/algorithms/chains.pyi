from collections.abc import Generator

from networkx.classes.graph import Graph, _Node

def chain_decomposition(G: Graph[_Node], root: _Node | None = None) -> Generator[list[tuple[_Node, _Node]], None, None]: ...
