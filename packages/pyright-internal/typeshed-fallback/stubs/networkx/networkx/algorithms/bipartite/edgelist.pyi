from _typeshed import Incomplete
from collections.abc import Generator

from networkx.utils.backends import _dispatchable

@_dispatchable
def write_edgelist(G, path, comments: str = "#", delimiter: str = " ", data: bool = True, encoding: str = "utf-8") -> None: ...
@_dispatchable
def generate_edgelist(G, delimiter: str = " ", data: bool = True) -> Generator[Incomplete, None, None]: ...
@_dispatchable
def parse_edgelist(
    lines,
    comments: str = "#",
    delimiter: Incomplete | None = None,
    create_using: Incomplete | None = None,
    nodetype: Incomplete | None = None,
    data: bool = True,
): ...
@_dispatchable
def read_edgelist(
    path,
    comments: str = "#",
    delimiter: Incomplete | None = None,
    create_using: Incomplete | None = None,
    nodetype: Incomplete | None = None,
    data: bool = True,
    edgetype: Incomplete | None = None,
    encoding: str = "utf-8",
): ...
