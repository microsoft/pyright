from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

class CorporaText(Record):
    __attributes__: Incomplete
    id: Incomplete
    parent_id: Incomplete
    name: Incomplete
    tags: Incomplete
    pars: Incomplete
    def __init__(self, id, parent_id, name, tags, pars) -> None: ...

class CorporaPar(Record):
    __attributes__: Incomplete
    id: Incomplete
    sents: Incomplete
    def __init__(self, id, sents) -> None: ...

class CorporaSent(Record):
    __attributes__: Incomplete
    id: Incomplete
    text: Incomplete
    tokens: Incomplete
    def __init__(self, id, text, tokens) -> None: ...

class CorporaToken(Record):
    __attributes__: Incomplete
    id: Incomplete
    rev_id: Incomplete
    text: Incomplete
    forms: Incomplete
    def __init__(self, id, rev_id, text, forms) -> None: ...

class CorporaForm(Record):
    __attributes__: Incomplete
    id: Incomplete
    text: Incomplete
    grams: Incomplete
    def __init__(self, id, text, grams) -> None: ...

def parse_grams(xml) -> Generator[Incomplete]: ...
def parse_forms(xml) -> Generator[Incomplete]: ...
def parse_tokens(xml) -> Generator[Incomplete]: ...
def parse_sents(xml) -> Generator[Incomplete]: ...
def parse_pars(xml) -> Generator[Incomplete]: ...
def parse_tags(xml) -> Generator[Incomplete]: ...
def parse_text(xml): ...
def load_corpora(path) -> Generator[Incomplete]: ...
