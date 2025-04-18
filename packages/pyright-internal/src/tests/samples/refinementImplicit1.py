# This sample tests the case where a class supports implicit refinement
# types through the __type_metadata__ magic method.

# pyright: reportMissingModuleSource=false

from typing import cast
from typing_extensions import Shape


class ClassA:
    @classmethod
    def __type_metadata__(cls, pred: str) -> Shape:
        return Shape(pred)


def test1(a: ClassA @ Shape("x, "), b: ClassA @ "y, ") -> ClassA @ "x, y":
    reveal_type(a, expected_text='ClassA @ "x,"')
    reveal_type(b, expected_text='ClassA @ "y,"')

    return cast(ClassA @ "x, y", ClassA())


def test2(m: ClassA @ "1, ", n: ClassA @ "2, "):
    v = test1(m, n)
    reveal_type(v, expected_text='ClassA @ "1, 2"')
