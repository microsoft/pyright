from networkx.utils.backends import _dispatchable

@_dispatchable
def k_components(G, min_density: float = 0.95): ...
