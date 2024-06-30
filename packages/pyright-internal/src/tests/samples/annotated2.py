# This sample tests the case where Annotated is used with deferred
# annotation evaluation.

from __future__ import annotations
from typing import Annotated


v1: Annotated[str, ClassA, func1(), v2[0]] = ""

v2 = [1, 2, 3]


class ClassA: ...


def func1(): ...
