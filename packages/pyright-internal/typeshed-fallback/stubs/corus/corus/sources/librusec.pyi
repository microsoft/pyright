from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

class LibrusecRecord(Record):
    __attributes__: Incomplete
    id: Incomplete
    text: Incomplete
    def __init__(self, id, text) -> None: ...

def flush(id, buffer): ...
def parse_librusec(lines) -> Generator[Incomplete]: ...
def load_librusec(path): ...
