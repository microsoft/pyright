# Parser errors should not produce a duplicate annotation-scope diagnostic.
from __future__ import annotations

from typing import Annotated

comprehension: Annotated[int, [item for item in (items := (1,))]] = 0
keyword: Annotated[int, dict(item=keyword_meta:=1)] = 0
dictionary_key: Annotated[int, {key_meta := 1: 2}] = 0


def unpacked(*args: *unpacked_meta := tuple[int, ...]):
    pass
