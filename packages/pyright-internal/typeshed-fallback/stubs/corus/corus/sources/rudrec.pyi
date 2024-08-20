from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

class RuDReCRecord(Record):
    __attributes__: Incomplete
    file_name: Incomplete
    text: Incomplete
    sentence_id: Incomplete
    entities: Incomplete
    def __init__(self, file_name, text, sentence_id, entities) -> None: ...

class RuDReCEntity(Record):
    __attributes__: Incomplete
    entity_id: Incomplete
    entity_text: Incomplete
    entity_type: Incomplete
    start: Incomplete
    end: Incomplete
    concept_id: Incomplete
    concept_name: Incomplete
    def __init__(self, entity_id, entity_text, entity_type, start, end, concept_id, concept_name) -> None: ...

def parse_entities(items) -> Generator[Incomplete]: ...
def parse_rudrec(items) -> Generator[Incomplete]: ...
def load_rudrec(path): ...
