from networkx.utils.backends import _dispatchable

@_dispatchable
def stochastic_graph(G, copy: bool = True, weight: str = "weight"): ...
