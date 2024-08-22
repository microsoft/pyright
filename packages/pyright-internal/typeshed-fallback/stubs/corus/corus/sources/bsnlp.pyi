from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

RU: str
BG: str
CS: str
PL: str
LANGS: Incomplete
ANNOTATED: str
RAW: str
TXT: str
OUT: str

class BsnlpId(Record):
    __attributes__: Incomplete
    lang: Incomplete
    type: Incomplete
    name: Incomplete
    path: Incomplete
    def __init__(self, lang, type, name, path) -> None: ...

class BsnlpRaw(Record):
    __attributes__: Incomplete
    id: Incomplete
    name: Incomplete
    lang: Incomplete
    date: Incomplete
    url: Incomplete
    text: Incomplete
    def __init__(self, id, name, lang, date, url, text) -> None: ...

class BsnlpAnnotated(Record):
    __attributes__: Incomplete
    id: Incomplete
    name: Incomplete
    substrings: Incomplete
    def __init__(self, id, name, substrings) -> None: ...

class BsnlpSubstring(Record):
    __attributes__: Incomplete
    text: Incomplete
    normal: Incomplete
    type: Incomplete
    id: Incomplete
    def __init__(self, text, normal, type, id) -> None: ...

class BsnlpMarkup(Record):
    __attributes__: Incomplete
    id: Incomplete
    name: Incomplete
    lang: Incomplete
    date: Incomplete
    url: Incomplete
    text: Incomplete
    substrings: Incomplete
    def __init__(self, id, name, lang, date, url, text, substrings) -> None: ...

def walk(dir): ...
def load_ids(dir, langs) -> Generator[Incomplete]: ...
def select_type(ids, type) -> Generator[Incomplete]: ...

RAW_PATTERN: Incomplete

def parse_raw(name, text): ...
def load_raw(records) -> Generator[Incomplete]: ...

ANNOTATED_PATTERN: Incomplete

def parse_substrings(lines) -> Generator[Incomplete]: ...
def parse_annotated(name, lines): ...
def load_annotated(records) -> Generator[Incomplete]: ...
def merge(raw, annotated) -> Generator[Incomplete]: ...
def load_bsnlp(dir, langs=["ru"]): ...
