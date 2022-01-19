# This sample tests the case where a subclass of Dict uses
# a dictionary literal as an argument to the constructor call.

from collections import Counter, defaultdict
from typing import Callable, Generic, Mapping, Optional, TypeVar

c1 = Counter({0, 1})
reveal_type(c1, expected_text="Counter[int]")

for i in range(256):
    c1 = Counter({0: c1[1]})
    reveal_type(c1, expected_text="Counter[int]")

reveal_type(c1, expected_text="Counter[int]")


K = TypeVar("K")
V = TypeVar("V")

MyFuncType = Callable[[Callable[[K], V]], V]


class MyFunc(Generic[K, V]):
    def __init__(self, g: MyFuncType[K, V]) -> None:
        self.g = g


MyFuncMapping = Mapping[K, Optional[MyFunc[K, V]]]

my_func_defaultdict: MyFuncMapping[str, int] = defaultdict(
    lambda: None, {"x": MyFunc(lambda f: f("a"))}
)
