from networkx.utils.backends import _dispatchable

@_dispatchable
def voronoi_cells(G, center_nodes, weight: str = "weight"): ...
