from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

TEXT: str
ANNO: str

class PersonsSpan(Record):
    __attributes__: Incomplete
    id: Incomplete
    start: Incomplete
    stop: Incomplete
    value: Incomplete
    def __init__(self, id, start, stop, value) -> None: ...

class PersonsMarkup(Record):
    __attributes__: Incomplete
    text: Incomplete
    spans: Incomplete
    def __init__(self, text, spans) -> None: ...

def list_ids(path) -> Generator[Incomplete]: ...
def part_names(ids, part) -> Generator[Incomplete]: ...
def parse_anno(text) -> Generator[Incomplete]: ...
def load_ids(ids, path) -> Generator[Incomplete]: ...
def load_persons(path): ...
