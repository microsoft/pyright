from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

__all__ = ["load_taiga_social"]

class TaigaSocialRecord(Record):
    __attributes__: Incomplete
    id: Incomplete
    network: Incomplete
    text: Incomplete
    def __init__(self, id, network, text) -> None: ...

def load_taiga_social(path, offset: int = 3985892864, count: int = 4) -> Generator[Incomplete]: ...
