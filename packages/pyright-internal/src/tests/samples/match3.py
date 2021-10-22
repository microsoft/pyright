# This sample tests type checking for match statements (as
# described in PEP 634) that contain class patterns.

from typing import Generic, Literal, NamedTuple, TypeVar, Union
from dataclasses import dataclass, field

foo = 3

class ClassA:
    __match_args__ = ("attr_a", "attr_b")
    attr_a: int
    attr_b: str

def test_unknown(value_to_match):
    match value_to_match:
        case ClassA(attr_a=a2) as a1:
            t_a1: Literal["Unknown"] = reveal_type(a1)
            t_a2: Literal["Unknown"] = reveal_type(a2)
            t_v1: Literal["Unknown"] = reveal_type(value_to_match)

        # This should generate an error because foo isn't instantiable.
        case foo() as a3:
            pass

def test_custom_type(value_to_match: ClassA):
    match value_to_match:
        case int() as a1:
            t_a1: Literal["Never"] = reveal_type(a1)
            t_v1: Literal["Never"] = reveal_type(value_to_match)

        case ClassA(attr_a=a4, attr_b=a5) as a3:
            t_a3: Literal["ClassA"] = reveal_type(a3)
            t_a4: Literal["int"] = reveal_type(a4)
            t_a5: Literal["str"] = reveal_type(a5)
            t_v3: Literal["ClassA"] = reveal_type(value_to_match)
            t_v2: Literal["ClassA"] = reveal_type(value_to_match)

        case ClassA(a6, a7):
            t_a6: Literal["int"] = reveal_type(a6)
            t_a7: Literal["str"] = reveal_type(a7)
            t_v3: Literal["ClassA"] = reveal_type(value_to_match)

        case ClassA() as a2:
            t_a2: Literal["ClassA"] = reveal_type(a2)
            t_v4: Literal["ClassA"] = reveal_type(value_to_match)


def test_literal(value_to_match: Literal[3]):
    match value_to_match:
        case int() as a1:
            t_a1: Literal["Literal[3]"] = reveal_type(a1)
            t_v1: Literal["Literal[3]"] = reveal_type(value_to_match)

        case float() as a2:
            t_a2: Literal["Never"] = reveal_type(a2)
            t_v2: Literal["Never"] = reveal_type(value_to_match)

        case str() as a3:
            t_a3: Literal["Never"] = reveal_type(a3)
            t_v3: Literal["Never"] = reveal_type(value_to_match)


TInt = TypeVar("TInt", bound=int)

def test_bound_typevar(value_to_match: TInt) -> TInt:
    match value_to_match:
        case int() as a1:
            t_a1: Literal["TInt@test_bound_typevar"] = reveal_type(a1)
            t_v1: Literal["TInt@test_bound_typevar"] = reveal_type(value_to_match)

        case float() as a2:
            t_a2: Literal["Never"] = reveal_type(a2)
            t_v2: Literal["Never"] = reveal_type(value_to_match)

        case str() as a3:
            t_a3: Literal["Never"] = reveal_type(a3)
            t_v3: Literal["Never"] = reveal_type(value_to_match)

    return value_to_match


def test_union(value_to_match: Union[TInt, Literal[3], float, str]) -> Union[TInt, Literal[3], float, str]:
    match value_to_match:
        case int() as a1:
            t_a1: Literal["TInt@test_union | int"] = reveal_type(a1)
            t_v1: Literal["TInt@test_union | int"] = reveal_type(value_to_match)

        case float() as a2:
            t_a2: Literal["float"] = reveal_type(a2)
            t_v2: Literal["float"] = reveal_type(value_to_match)

        case str() as a3:
            t_a3: Literal["str"] = reveal_type(a3)
            t_v3: Literal["str"] = reveal_type(value_to_match)

    return value_to_match


T = TypeVar("T")

class Point(Generic[T]):
    __match_args__ = ("x", "y")
    x: T
    y: T


def func1(points: list[Point[float] | Point[complex]]):
    match points:
        case [] as a1:
            t_a1: Literal["list[Point[float] | Point[complex]]"] = reveal_type(a1)
            t_v1: Literal["list[Point[float] | Point[complex]]"] = reveal_type(points)

        case [Point(0, 0) as b1]:
            t_b1: Literal["Point[float] | Point[complex]"] = reveal_type(b1)
            t_v2: Literal["list[Point[float] | Point[complex]]"] = reveal_type(points)

        case [Point(c1, c2)]:
            t_c1: Literal["float | complex"] = reveal_type(c1)
            t_c2: Literal["float | complex"] = reveal_type(c2)
            t_v3: Literal["list[Point[float] | Point[complex]]"] = reveal_type(points)

        case [Point(0, d1), Point(0, d2)]:
            t_d1: Literal["float | complex"] = reveal_type(d1)
            t_d2: Literal["float | complex"] = reveal_type(d2)
            t_v4: Literal["list[Point[float] | Point[complex]]"] = reveal_type(points)

        case _ as e1:
            t_e1: Literal["list[Point[float] | Point[complex]]"] = reveal_type(e1)
            t_v5: Literal["list[Point[float] | Point[complex]]"] = reveal_type(points)


def func2(subj: object):
    match subj:
        case list() as a1:
            t_a1: Literal["list[Unknown]"] = reveal_type(a1)
            t_v1: Literal["list[Unknown]"] = reveal_type(subj)


def func3(subj: Union[int, str, dict[str, str]]):
    match subj:
        case int(x):
            t_x1: Literal["int"] = reveal_type(x)
            t_v1: Literal["int"] = reveal_type(subj)

        case str(x):
            t_x2: Literal["str"] = reveal_type(x)
            t_v2: Literal["str"] = reveal_type(subj)

        case dict(x):
            t_x3: Literal["dict[str, str]"] = reveal_type(x)
            t_v3: Literal["dict[str, str]"] = reveal_type(subj)


def func4(subj: object):
    match subj:
        case int(x):
            t_x1: Literal["int"] = reveal_type(x)
            t_v1: Literal["int"] = reveal_type(subj)

        case str(x):
            t_x2: Literal["str"] = reveal_type(x)
            t_v2: Literal["str"] = reveal_type(subj)


# Test the auto-generation of __match_args__ for dataclass.
@dataclass
class Dataclass1:
    val1: int
    val2: str = field(init=False)
    val3: complex

@dataclass
class Dataclass2:
    val1: int
    val2: str
    val3: float


def func5(subj: object):
    match subj:
        case Dataclass1(a, b):
            t_a1: Literal["int"] = reveal_type(a)
            t_b1: Literal["complex"] = reveal_type(b)
            t_v1: Literal["Dataclass1"] = reveal_type(subj)

        case Dataclass2(a, b, c):
            t_a2: Literal["int"] = reveal_type(a)
            t_b2: Literal["str"] = reveal_type(b)
            t_c2: Literal["float"] = reveal_type(c)
            t_v2: Literal["Dataclass2"] = reveal_type(subj)


# Test the auto-generation of __match_args__ for named tuples.
NT1 = NamedTuple("NT1", [("val1", int), ("val2", complex)])
NT2 = NamedTuple("NT2", [("val1", int), ("val2", str), ("val3", float)])

def func6(subj: object):
    match subj:
        case NT1(a, b):
            t_a1: Literal["int"] = reveal_type(a)
            t_b1: Literal["complex"] = reveal_type(b)
            t_v1: Literal["NT1"] = reveal_type(subj)

        case NT2(a, b, c):
            t_a2: Literal["int"] = reveal_type(a)
            t_b2: Literal["str"] = reveal_type(b)
            t_c2: Literal["float"] = reveal_type(c)
            t_v2: Literal["NT2"] = reveal_type(subj)


def func7(subj: object):
    match subj:
        case complex(real=a, imag=b):
            t_a1: Literal["float"] = reveal_type(a)
            t_b1: Literal["float"] = reveal_type(b)

T2 = TypeVar("T2")


class Parent(Generic[T]):
    ...


class Child1(Parent[T]):
    ...


class Child2(Parent[T], Generic[T, T2]):
    ...


def other_func(subj: Parent[int]):
    match subj:
        case Child1() as a1:
            t_a1: Literal['Child1[int]'] = reveal_type(a1)
            t_a: Literal['Child1[int]'] = reveal_type(subj)

        case Child2() as b1:
            t_b1: Literal['Child2[int, Unknown]'] = reveal_type(b1)
            t_b: Literal['Child2[int, Unknown]'] = reveal_type(subj)
