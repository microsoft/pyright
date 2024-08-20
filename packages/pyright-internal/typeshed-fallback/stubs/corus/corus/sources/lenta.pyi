from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

class LentaRecord(Record):
    __attributes__: Incomplete
    url: Incomplete
    title: Incomplete
    text: Incomplete
    topic: Incomplete
    tags: Incomplete
    date: Incomplete
    def __init__(self, url, title, text, topic, tags, date: Incomplete | None = None) -> None: ...

def parse_lenta(lines) -> Generator[Incomplete]: ...
def parse_lenta2(lines) -> Generator[Incomplete]: ...
def load_lenta(path): ...
def load_lenta2(path): ...
