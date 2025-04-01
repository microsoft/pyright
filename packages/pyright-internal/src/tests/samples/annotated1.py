# This sample tests handling of the Python 3.9 "Annotated" feature
# described in PEP 593.

from dataclasses import InitVar, dataclass
from typing import Annotated, ClassVar, Final, TypeVar


class struct2:
    @staticmethod
    def ctype(a: str):
        pass

    class Packed:
        pass


UnsignedShort = Annotated[int, struct2.ctype("H")]
SignedChar = Annotated[int, struct2.ctype("b")]


class Student(struct2.Packed):
    name: Annotated[str, struct2.ctype("<10s")]
    serial_num: UnsignedShort
    school: SignedChar


def ValueRange(a: int, b: int):
    pass


T1 = Annotated[int, ValueRange(-10, 5)]
T2 = Annotated[T1, ValueRange(-20, 3)]

a: Annotated[Annotated[int, "hi"], "hi"] = 3
b: T2 = 5

TypeWithStringArg = Annotated["int", "this string should not be parsed"]


def func2(a: TypeWithStringArg):
    return 3


# This should generate an error because the first type argument
# is not a valid type.
c: Annotated["this", "should generate an error"]

# This should generate an error because all Annotated types should
# include at least two type arguments.
d: Annotated[int]

# Verify that generic type aliases can be defined using Annotated.
_T = TypeVar("_T")
Param = Annotated[_T, "x"]

x1: Param[int] = 3
print(Param[int])


class A:
    classvar: Annotated[ClassVar[int], (2, 5)] = 4
    const: Annotated[Final[int], "metadata"] = 4


@dataclass
class B:
    x: Annotated[InitVar[int], "metadata"]


d1 = B(x=4)

# This should generate an error because x is not an actual member.
d1.x

Alias1 = Annotated[_T, ""]
Alias2 = str
Alias3 = Alias1[Alias2]

reveal_type(Alias3, expected_text="type[str]")

x2: Annotated[str, [*(1, 2)]]
x3: Annotated[str, (temp := 1)]


async def func3():
    x4: Annotated[str, await func3()]


x5: Annotated[str, f""]
x6: Annotated[str, "abc"]
x7: Annotated[str, "a\nb"]
x8: Annotated[str, *(1, 2, 3)]


def func4():
    return Annotated[int, 2 + 2]


reveal_type(func4(), expected_text="Annotated")

x9 = list[Annotated[int, ""]]()
reveal_type(x9, expected_text="list[int]")
