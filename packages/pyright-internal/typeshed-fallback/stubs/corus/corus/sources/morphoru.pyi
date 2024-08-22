from _typeshed import Incomplete

from corus.record import Record

__all__ = ["load_morphoru_gicrya", "load_morphoru_rnc", "load_morphoru_corpora"]

class MorphoSent(Record):
    __attributes__: Incomplete
    tokens: Incomplete
    attrs: Incomplete
    def __init__(self, tokens, attrs=()) -> None: ...

class MorphoToken(Record):
    __attributes__: Incomplete
    text: Incomplete
    lemma: Incomplete
    pos: Incomplete
    feats: Incomplete
    feats2: Incomplete
    def __init__(self, text, lemma, pos, feats, feats2: Incomplete | None = None) -> None: ...

def load_morphoru_gicrya(path): ...
def load_morphoru_rnc(path): ...
def load_morphoru_corpora(path): ...
