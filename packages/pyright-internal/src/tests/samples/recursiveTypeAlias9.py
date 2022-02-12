# This sample tests that recursive type aliases work well with
# a generic dataclass constructor.

from dataclasses import dataclass
from typing import Union, Generic, TypeVar

A = TypeVar("A")
JSON = Union[str, dict[str, "JSON"]]


@dataclass
class Example(Generic[A]):
    val: A


a: JSON = {"a": "b"}
b: JSON = "a"
c: Example[JSON] = Example(a)
d: Example[JSON] = Example("a")
e: Example[JSON] = Example({})
f: Example[JSON] = Example({"a": "b"})
g: Example[JSON] = Example({"a": {"a": "b"}})
