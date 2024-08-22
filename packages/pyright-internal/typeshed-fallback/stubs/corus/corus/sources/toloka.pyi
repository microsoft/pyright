from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

class LRWCRecord(Record):
    __attributes__: Incomplete
    hyponym: Incomplete
    hypernym: Incomplete
    genitive: Incomplete
    judgement: Incomplete
    confidence: Incomplete
    def __init__(self, hyponym, hypernym, genitive, judgement, confidence) -> None: ...

def parse_judgement(value): ...
def parse_confidence(value): ...
def parse_toloka_lrwc(lines) -> Generator[Incomplete]: ...
def load_toloka_lrwc(path): ...

class RuADReCTRecord(Record):
    __attributes__: Incomplete
    tweet_id: Incomplete
    tweet: Incomplete
    label: Incomplete
    def __init__(self, tweet_id, tweet, label) -> None: ...

def parse_ruadrect(lines) -> Generator[Incomplete]: ...
def load_ruadrect(path): ...
