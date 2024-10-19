from _typeshed import Incomplete
from collections.abc import Generator

from networkx.utils.backends import _dispatchable

@_dispatchable
def nonisomorphic_trees(order, create: str = "graph") -> Generator[Incomplete, None, None]: ...
@_dispatchable
def number_of_nonisomorphic_trees(order): ...
