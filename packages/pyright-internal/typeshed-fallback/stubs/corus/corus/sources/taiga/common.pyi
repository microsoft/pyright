from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

class ArchiveRecord(Record):
    __attributes__: Incomplete
    name: Incomplete
    offset: Incomplete
    file: Incomplete
    def __init__(self, name, offset, file) -> None: ...

class TaigaRecord(Record):
    __attributes__: Incomplete
    id: Incomplete
    meta: Incomplete
    text: Incomplete
    def __init__(self, id, meta, text) -> None: ...

class Author(Record):
    __attributes__: Incomplete
    name: Incomplete
    readers: Incomplete
    texts: Incomplete
    profession: Incomplete
    about: Incomplete
    url: Incomplete
    def __init__(self, name, readers=None, texts=None, profession=None, about=None, url=None) -> None: ...

class Meta(Record):
    __attributes__: Incomplete
    id: Incomplete
    timestamp: Incomplete
    tags: Incomplete
    themes: Incomplete
    rubric: Incomplete
    genre: Incomplete
    topic: Incomplete
    author: Incomplete
    lang: Incomplete
    title: Incomplete
    url: Incomplete
    def __init__(
        self,
        id,
        timestamp=None,
        tags=None,
        themes=None,
        rubric=None,
        genre=None,
        topic=None,
        author=None,
        lang=None,
        title=None,
        url=None,
    ) -> None: ...

def load_tar(path, offset: int = 0) -> Generator[Incomplete]: ...
def load_zip(path, offset: int = 0) -> Generator[Incomplete]: ...
def parse_meta(file, encoding: str = "utf8") -> Generator[Incomplete]: ...
def load_metas(path, pattern, offset, count, load) -> Generator[Incomplete]: ...
def load_tar_metas(path, pattern, offset, count): ...
def load_zip_metas(path, pattern, offset, count): ...
def load_texts(path, pattern, offset, count, parse_id, load, encoding: str = "utf8") -> Generator[Incomplete]: ...
def parse_filename_id(path): ...
def load_tar_texts(path, pattern, offset, count, parse_id=...): ...
def load_zip_texts(path, pattern, offset, count, parse_id=...): ...
def merge_metas(records, metas=None) -> Generator[Incomplete]: ...
def patch_month(date, months): ...
