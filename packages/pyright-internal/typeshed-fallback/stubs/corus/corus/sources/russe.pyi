from _typeshed import Incomplete

from corus.record import Record

__all__ = ["load_russe_hj", "load_russe_rt", "load_russe_ae"]

class RusseSemRecord(Record):
    __attributes__: Incomplete
    word1: Incomplete
    word2: Incomplete
    sim: Incomplete
    def __init__(self, word1, word2, sim) -> None: ...

def load_russe_hj(path): ...
def load_russe_rt(path): ...
def load_russe_ae(path): ...
