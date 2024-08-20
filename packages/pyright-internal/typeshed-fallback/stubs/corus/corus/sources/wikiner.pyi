from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

class WikinerToken(Record):
    __attributes__: Incomplete
    text: Incomplete
    pos: Incomplete
    tag: Incomplete
    def __init__(self, text, pos, tag) -> None: ...

class WikinerMarkup(Record):
    __attributes__: Incomplete
    tokens: Incomplete
    def __init__(self, tokens) -> None: ...

def parse_wikiner(line): ...
def load_wikiner(path) -> Generator[Incomplete]: ...
