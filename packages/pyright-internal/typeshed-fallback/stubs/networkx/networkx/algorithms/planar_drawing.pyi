from networkx.utils.backends import _dispatchable

__all__ = ["combinatorial_embedding_to_pos"]

@_dispatchable
def combinatorial_embedding_to_pos(embedding, fully_triangulate: bool = False): ...
