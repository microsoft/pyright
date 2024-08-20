from _typeshed import Incomplete

from corus.record import Record

__all__ = [
    "load_ods_interfax",
    "load_ods_gazeta",
    "load_ods_izvestia",
    "load_ods_meduza",
    "load_ods_ria",
    "load_ods_rt",
    "load_ods_tass",
]

class NewsRecord(Record):
    __attributes__: Incomplete
    timestamp: Incomplete
    url: Incomplete
    edition: Incomplete
    topics: Incomplete
    authors: Incomplete
    title: Incomplete
    text: Incomplete
    stats: Incomplete
    def __init__(self, timestamp, url, edition, topics, authors, title, text, stats) -> None: ...

class Stats(Record):
    __attributes__: Incomplete
    fb: Incomplete
    vk: Incomplete
    ok: Incomplete
    twitter: Incomplete
    lj: Incomplete
    tg: Incomplete
    likes: Incomplete
    views: Incomplete
    comments: Incomplete
    def __init__(self, fb, vk, ok, twitter, lj, tg, likes, views, comments) -> None: ...

def load_ods_interfax(path): ...
def load_ods_gazeta(path): ...
def load_ods_izvestia(path): ...
def load_ods_meduza(path): ...
def load_ods_ria(path): ...
def load_ods_rt(path): ...
def load_ods_tass(path): ...
