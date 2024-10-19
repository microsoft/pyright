from _typeshed import Incomplete
from collections.abc import Generator

from networkx.utils.backends import _dispatchable

@_dispatchable
def attracting_components(G) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def number_attracting_components(G): ...
@_dispatchable
def is_attracting_component(G): ...
