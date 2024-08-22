from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

class SimlexRecord(Record):
    __attributes__: Incomplete
    word1: Incomplete
    word2: Incomplete
    score: Incomplete
    def __init__(self, word1, word2, score) -> None: ...

def parse_simlex(lines) -> Generator[Incomplete]: ...
def load_simlex(path): ...
