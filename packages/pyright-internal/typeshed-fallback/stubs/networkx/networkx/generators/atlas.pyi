from importlib.abc import Traversable
from typing import Final

from networkx.utils.backends import _dispatchable

__all__ = ["graph_atlas", "graph_atlas_g"]

NUM_GRAPHS: Final = 1253
ATLAS_FILE: Final[Traversable]

@_dispatchable
def graph_atlas(i): ...
@_dispatchable
def graph_atlas_g(): ...
