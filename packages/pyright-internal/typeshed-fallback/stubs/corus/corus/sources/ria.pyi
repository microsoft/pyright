from _typeshed import Incomplete

from corus.record import Record

__all__ = ["load_ria_raw", "load_ria"]

class RiaRawRecord(Record):
    __attributes__: Incomplete
    title: Incomplete
    text: Incomplete
    def __init__(self, title, text) -> None: ...

class RiaRecord(Record):
    __attributes__: Incomplete
    title: Incomplete
    prefix: Incomplete
    text: Incomplete
    def __init__(self, title, prefix, text) -> None: ...

def load_ria_raw(path): ...
def load_ria(path): ...
