from _typeshed import Incomplete

from corus.record import Record

__all__ = ["load_buriy_news", "load_buriy_webhose"]

class BuriyRecord(Record):
    __attributes__: Incomplete
    timestamp: Incomplete
    url: Incomplete
    edition: Incomplete
    topics: Incomplete
    title: Incomplete
    text: Incomplete
    def __init__(self, timestamp, url, edition, topics, title, text) -> None: ...

def load_buriy_news(path): ...
def load_buriy_webhose(path): ...
