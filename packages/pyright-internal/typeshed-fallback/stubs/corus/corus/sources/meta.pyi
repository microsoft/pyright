from _typeshed import Incomplete

from corus.record import Record

class Meta(Record):
    __attributes__: Incomplete
    title: Incomplete
    url: Incomplete
    description: Incomplete
    stats: Incomplete
    instruction: Incomplete
    tags: Incomplete
    functions: Incomplete
    def __init__(self, title, url=None, description=None, stats=None, instruction=(), tags=(), functions=()) -> None: ...

class Group(Record):
    __attributes__: Incomplete
    title: Incomplete
    url: Incomplete
    description: Incomplete
    instruction: Incomplete
    metas: Incomplete
    def __init__(self, title, url=None, description=None, instruction=(), metas=()) -> None: ...

def is_group(item): ...

class Stats(Record):
    __attributes__: Incomplete
    bytes: Incomplete
    count: Incomplete
    def __init__(self, bytes=None, count=None) -> None: ...

NER: str
NEWS: str
FICTION: str
SOCIAL: str
MORPH: str
SYNTAX: str
EMB: str
SIM: str
SENTIMENT: str
WEB: str
METAS: Incomplete
