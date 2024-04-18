# This sample tests the case where a generic class contains a
# __new__ method that returns a Self type and an __init__ method
# that provides specialization for the Self type. When evaluating
# the __new__ method, we don't want to specialize the Self type
# too early.

from dataclasses import dataclass
from typing import Generic, Self, TypeVar, overload


_ = isinstance(dict(a=0), dict)


class ClassA: ...


_T1 = TypeVar("_T1", bound=ClassA | str, covariant=True)
_T2 = TypeVar("_T2")


class ClassB(Generic[_T1]):
    def __new__(cls, *args, **kwargs) -> Self:
        return super().__new__(cls, *args, **kwargs)

    @overload
    def __init__(self, arg: _T1) -> None: ...

    @overload
    def __init__(self: "ClassB[str]", arg: int) -> None: ...

    def __init__(self, arg: int | ClassA | str) -> None:
        pass


b1: ClassB[ClassA | str] = ClassB[str](32)


@dataclass
class ClassC(Generic[_T2]):
    value: _T2


c1: ClassC[int] | ClassC[str] = ClassC("hi")
c2: ClassC[int] | ClassC[str] = ClassC(1)
