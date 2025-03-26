# This sample tests that unspecified type parameters
# for a class instance are "unknown".

from collections import defaultdict
from queue import Queue
from typing import DefaultDict, List, Type, TypeVar

val1 = Queue()
reveal_type(val1, expected_text="Queue[Unknown]")

val2 = list()
reveal_type(val2, expected_text="list[Unknown]")

_T = TypeVar("_T")


def foo(value: Type[_T], b: _T) -> None:
    val1: "DefaultDict[str, list[_T]]" = defaultdict(list)
    reveal_type(val1, expected_text="DefaultDict[str, list[_T@foo]]")

    val2: "DefaultDict[str, list[_T]]" = defaultdict(List[_T])
    reveal_type(val2, expected_text="DefaultDict[str, list[_T@foo]]")

    # This should generate an error because the type is incompatible.
    val3: "DefaultDict[str, list[_T]]" = defaultdict(list[int])
