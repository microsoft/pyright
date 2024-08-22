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
    def __init__(
        self,
        name,
        readers: Incomplete | None = None,
        texts: Incomplete | None = None,
        profession: Incomplete | None = None,
        about: Incomplete | None = None,
        url: Incomplete | None = None,
    ) -> None: ...

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
        timestamp: Incomplete | None = None,
        tags: Incomplete | None = None,
        themes: Incomplete | None = None,
        rubric: Incomplete | None = None,
        genre: Incomplete | None = None,
        topic: Incomplete | None = None,
        author: Incomplete | None = None,
        lang: Incomplete | None = None,
        title: Incomplete | None = None,
        url: Incomplete | None = None,
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
def merge_metas(records, metas: Incomplete | None = None) -> Generator[Incomplete]: ...
def patch_month(date, months): ...
