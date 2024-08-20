from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

DEVSET: str
TESTSET: str
TXT: str
SPANS: str
OBJECTS: str
COREF: str
FACTS: str

class FactruSpan(Record):
    __attributes__: Incomplete
    id: Incomplete
    type: Incomplete
    start: Incomplete
    stop: Incomplete
    def __init__(self, id, type, start, stop) -> None: ...

class FactruObject(Record):
    __attributes__: Incomplete
    id: Incomplete
    type: Incomplete
    spans: Incomplete
    def __init__(self, id, type, spans) -> None: ...

class FactruCorefSlot(Record):
    __attributes__: Incomplete
    type: Incomplete
    value: Incomplete
    def __init__(self, type, value) -> None: ...

class FactruCoref(Record):
    __attributes__: Incomplete
    id: Incomplete
    objects: Incomplete
    slots: Incomplete
    def __init__(self, id, objects, slots) -> None: ...

class FactruFactSlot(Record):
    __attributes__: Incomplete
    type: Incomplete
    ref: Incomplete
    value: Incomplete
    def __init__(self, type, ref, value) -> None: ...

class FactruFact(Record):
    __attributes__: Incomplete
    id: Incomplete
    type: Incomplete
    slots: Incomplete
    def __init__(self, id, type, slots) -> None: ...

class FactruMarkup(Record):
    __attributes__: Incomplete
    id: Incomplete
    text: Incomplete
    objects: Incomplete
    corefs: Incomplete
    facts: Incomplete
    def __init__(self, id, text, objects, corefs, facts) -> None: ...

def list_ids(dir, set) -> Generator[Incomplete]: ...
def part_path(id, dir, set, part): ...
def parse_spans(lines) -> Generator[Incomplete]: ...
def parse_objects(lines, spans) -> Generator[Incomplete]: ...
def parse_coref_slots(lines) -> Generator[Incomplete]: ...
def parse_corefs(lines, objects) -> Generator[Incomplete]: ...
def parse_facts_slots(lines, id_corefs, id_spans) -> Generator[Incomplete]: ...
def parse_facts(lines, corefs, spans) -> Generator[Incomplete]: ...
def load_id(id, dir, set): ...
def load_factru(dir, sets=["devset", "testset"]) -> Generator[Incomplete]: ...
