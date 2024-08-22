from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record
from corus.third.WikiExtractor import Extractor

class WikiRecord(Record):
    __attributes__: Incomplete
    id: Incomplete
    url: Incomplete
    title: Incomplete
    text: Incomplete
    def __init__(self, id, url, title, text) -> None: ...
    @classmethod
    def from_json(cls, data): ...

class Extractor_(Extractor):
    def extract_(self): ...

def load_wiki(path) -> Generator[Incomplete]: ...
