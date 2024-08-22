from _typeshed import Incomplete

from corus.record import Record

__all__ = ["load_ud_gsd", "load_ud_taiga", "load_ud_pud", "load_ud_syntag"]

class UDSent(Record):
    __attributes__: Incomplete
    id: Incomplete
    text: Incomplete
    attrs: Incomplete
    tokens: Incomplete
    def __init__(self, id, text, attrs, tokens) -> None: ...

class UDToken(Record):
    __attributes__: Incomplete
    id: Incomplete
    text: Incomplete
    lemma: Incomplete
    pos: Incomplete
    feats: Incomplete
    head_id: Incomplete
    rel: Incomplete
    def __init__(self, id, text, lemma, pos, feats, head_id, rel) -> None: ...

def load_ud_gsd(path): ...
def load_ud_taiga(path): ...
def load_ud_pud(path): ...
def load_ud_syntag(path): ...
