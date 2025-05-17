from networkx.utils.backends import _dispatchable

__all__ = ["graph_atlas", "graph_atlas_g"]

@_dispatchable
def graph_atlas(i): ...
@_dispatchable
def graph_atlas_g(): ...
