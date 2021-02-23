# This sample verifies the case where a property returns a callable

from typing import Callable, Literal


class ClassA:
    def __init__(self, converter: Callable[[str, int], int]) -> None:
        self.converter = converter

    @property
    def converter_prop(self) -> Callable[[str, int], int]:
        return self.converter


def str_to_int(arg: str, base: int) -> int:
    return int(arg, base=base)


obj = ClassA(str_to_int)
val1: int = obj.converter("123", 10)
val2: int = obj.converter_prop("123", 10)

t1: Literal["(_p0: str, _p1: int) -> int"] = reveal_type(obj.converter)
t2: Literal["(_p0: str, _p1: int) -> int"] = reveal_type(obj.converter_prop)
