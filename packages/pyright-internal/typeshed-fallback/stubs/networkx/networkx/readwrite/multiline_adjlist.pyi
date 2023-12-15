from _typeshed import Incomplete
from collections.abc import Generator

def generate_multiline_adjlist(G, delimiter: str = " ") -> Generator[Incomplete, None, None]: ...
def write_multiline_adjlist(G, path, delimiter: str = " ", comments: str = "#", encoding: str = "utf-8") -> None: ...
def parse_multiline_adjlist(
    lines,
    comments: str = "#",
    delimiter: Incomplete | None = None,
    create_using: Incomplete | None = None,
    nodetype: Incomplete | None = None,
    edgetype: Incomplete | None = None,
): ...
def read_multiline_adjlist(
    path,
    comments: str = "#",
    delimiter: Incomplete | None = None,
    create_using: Incomplete | None = None,
    nodetype: Incomplete | None = None,
    edgetype: Incomplete | None = None,
    encoding: str = "utf-8",
): ...
