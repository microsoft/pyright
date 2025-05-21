# This sample tests type checking for match statements (as
# described in PEP 634) that contain class patterns.

from typing import (
    Any,
    Generic,
    Literal,
    NamedTuple,
    Protocol,
    TypeVar,
    TypedDict,
    runtime_checkable,
)
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    LiteralString,
)
from dataclasses import dataclass, field

foo = 3

T = TypeVar("T")


class ClassA:
    __match_args__ = ("attr_a", "attr_b")
    attr_a: int
    attr_b: str


class ClassB(Generic[T]):
    __match_args__ = ("attr_a", "attr_b")
    attr_a: T
    attr_b: str


class ClassC: ...


class ClassD(ClassC): ...


def test_unknown(value_to_match):
    match value_to_match:
        case ClassA(attr_a=a2) as a1:
            reveal_type(a1, expected_text="ClassA")
            reveal_type(a2, expected_text="int")
            reveal_type(value_to_match, expected_text="ClassA")

        # This should generate an error because foo isn't instantiable.
        case foo() as a3:
            pass


def test_any(value_to_match: Any):
    match value_to_match:
        case list() as a1:
            reveal_type(a1, expected_text="list[Unknown]")
            reveal_type(value_to_match, expected_text="list[Unknown]")


def test_custom_type(value_to_match: ClassA | ClassB[int] | ClassB[str] | ClassC):
    match value_to_match:
        case int() as a1:
            reveal_type(a1, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

        case ClassA(attr_a=a4, attr_b=a5) as a3:
            reveal_type(a3, expected_text="ClassA")
            reveal_type(a4, expected_text="int")
            reveal_type(a5, expected_text="str")
            reveal_type(value_to_match, expected_text="ClassA")
            reveal_type(value_to_match, expected_text="ClassA")

        case ClassB(a6, a7):
            reveal_type(a6, expected_text="int | str")
            reveal_type(a7, expected_text="str")
            reveal_type(value_to_match, expected_text="ClassB[int] | ClassB[str]")

        case ClassD() as a2:
            reveal_type(a2, expected_text="ClassD")
            reveal_type(value_to_match, expected_text="ClassD")

        case ClassC() as a8:
            reveal_type(a8, expected_text="ClassC")
            reveal_type(value_to_match, expected_text="ClassC")


def test_subclass(value_to_match: ClassD):
    match value_to_match:
        case ClassC() as a1:
            reveal_type(a1, expected_text="ClassD")

        case _ as a2:
            reveal_type(a2, expected_text="Never")


def test_literal(value_to_match: Literal[3]):
    match value_to_match:
        case float() as a2:
            reveal_type(a2, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

        case str() as a3:
            reveal_type(a3, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

        case int() as a1:
            reveal_type(a1, expected_text="Literal[3]")
            reveal_type(value_to_match, expected_text="Literal[3]")


def test_literal2(value_to_match: Literal[0, "1", b"2"]) -> None:
    match value_to_match:
        case float() as a2:
            reveal_type(a2, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

        case str() as a3:
            reveal_type(a3, expected_text="Literal['1']")
            reveal_type(value_to_match, expected_text="Literal['1']")

        case int() as a1:
            reveal_type(a1, expected_text="Literal[0]")
            reveal_type(value_to_match, expected_text="Literal[0]")

        case x:
            reveal_type(x, expected_text='Literal[b"2"]')
            reveal_type(value_to_match, expected_text='Literal[b"2"]')


def test_literal_string(value_to_match: LiteralString) -> None:
    match value_to_match:
        case "a" as a1:
            reveal_type(value_to_match, expected_text="Literal['a']")
            reveal_type(a1, expected_text="Literal['a']")

        case str() as a2:
            reveal_type(value_to_match, expected_text="LiteralString")
            reveal_type(a2, expected_text="LiteralString")

        case a3:
            reveal_type(value_to_match, expected_text="Never")
            reveal_type(a3, expected_text="Never")


TFloat = TypeVar("TFloat", bound=float)


def test_bound_typevar(value_to_match: TFloat) -> TFloat:
    match value_to_match:
        case int() as a1:
            reveal_type(a1, expected_text="int*")
            reveal_type(value_to_match, expected_text="int*")

        case float() as a2:
            reveal_type(a2, expected_text="float*")
            reveal_type(value_to_match, expected_text="float*")

        case str() as a3:
            reveal_type(a3, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

    return value_to_match


TInt = TypeVar("TInt", bound=int)


def test_union(
    value_to_match: TInt | Literal[3] | float | str,
) -> TInt | Literal[3] | float | str:
    match value_to_match:
        case int() as a1:
            reveal_type(a1, expected_text="int* | int")
            reveal_type(value_to_match, expected_text="int* | int")

        case float() as a2:
            reveal_type(a2, expected_text="float")
            reveal_type(value_to_match, expected_text="float")

        case str() as a3:
            reveal_type(a3, expected_text="str")
            reveal_type(value_to_match, expected_text="str")

    return value_to_match


T = TypeVar("T")


class Point(Generic[T]):
    __match_args__ = ("x", "y")
    x: T
    y: T


def func1(points: list[Point[float] | Point[complex]]):
    match points:
        case [] as a1:
            reveal_type(a1, expected_text="list[Point[float] | Point[complex]]")
            reveal_type(points, expected_text="list[Point[float] | Point[complex]]")

        case [Point(0, 0) as b1]:
            reveal_type(b1, expected_text="Point[float] | Point[complex]")
            reveal_type(points, expected_text="list[Point[float] | Point[complex]]")

        case [Point(c1, c2)]:
            reveal_type(c1, expected_text="float | complex")
            reveal_type(c2, expected_text="float | complex")
            reveal_type(points, expected_text="list[Point[float] | Point[complex]]")

        case [Point(0, d1), Point(0, d2)]:
            reveal_type(d1, expected_text="float | complex")
            reveal_type(d2, expected_text="float | complex")
            reveal_type(points, expected_text="list[Point[float] | Point[complex]]")

        case _ as e1:
            reveal_type(e1, expected_text="list[Point[float] | Point[complex]]")
            reveal_type(points, expected_text="list[Point[float] | Point[complex]]")


def func2(subj: object):
    match subj:
        case list() as a1:
            reveal_type(a1, expected_text="list[Unknown]")
            reveal_type(subj, expected_text="list[Unknown]")


def func3(subj: int | str | dict[str, str]):
    match subj:
        case int(x):
            reveal_type(x, expected_text="int")
            reveal_type(subj, expected_text="int")

        case str(x):
            reveal_type(x, expected_text="str")
            reveal_type(subj, expected_text="str")

        case dict(x):
            reveal_type(x, expected_text="dict[str, str]")
            reveal_type(subj, expected_text="dict[str, str]")


def func4(subj: object):
    match subj:
        case int(x):
            reveal_type(x, expected_text="int")
            reveal_type(subj, expected_text="int")

        case str(x):
            reveal_type(x, expected_text="str")
            reveal_type(subj, expected_text="str")


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
            reveal_type(a, expected_text="int")
            reveal_type(b, expected_text="complex")
            reveal_type(subj, expected_text="Dataclass1")

        case Dataclass2(a, b, c):
            reveal_type(a, expected_text="int")
            reveal_type(b, expected_text="str")
            reveal_type(c, expected_text="float")
            reveal_type(subj, expected_text="Dataclass2")


# Test the auto-generation of __match_args__ for named tuples.
NT1 = NamedTuple("NT1", [("val1", int), ("val2", complex)])
NT2 = NamedTuple("NT2", [("val1", int), ("val2", str), ("val3", float)])


def func6(subj: object):
    match subj:
        case NT1(a, b):
            reveal_type(a, expected_text="int")
            reveal_type(b, expected_text="complex")
            reveal_type(subj, expected_text="NT1")

        case NT2(a, b, c):
            reveal_type(a, expected_text="int")
            reveal_type(b, expected_text="str")
            reveal_type(c, expected_text="float")
            reveal_type(subj, expected_text="NT2")


def func7(subj: object):
    match subj:
        case complex(real=a, imag=b):
            reveal_type(a, expected_text="float")
            reveal_type(b, expected_text="float")


T2 = TypeVar("T2")


class Parent(Generic[T]): ...


class Child1(Parent[T]): ...


class Child2(Parent[T], Generic[T, T2]): ...


def func8(subj: Parent[int]):
    match subj:
        case Child1() as a1:
            reveal_type(a1, expected_text="Child1[int]")
            reveal_type(subj, expected_text="Child1[int]")

        case Child2() as b1:
            reveal_type(b1, expected_text="Child2[int, Unknown]")
            reveal_type(subj, expected_text="Child2[int, Unknown]")


T3 = TypeVar("T3")


def func9(v: T3) -> T3 | None:
    match v:
        case str():
            reveal_type(v, expected_text="str*")
            return v

        case _:
            return None


T4 = TypeVar("T4", int, str)


def func10(v: T4) -> T4 | None:
    match v:
        case str():
            reveal_type(v, expected_text="str*")
            return v

        case int():
            reveal_type(v, expected_text="int*")
            return v

        case list():
            reveal_type(v, expected_text="Never")
            return v

        case _:
            return None


def func11(subj: Any):
    match subj:
        case Child1() as a1:
            reveal_type(a1, expected_text="Child1[Unknown]")
            reveal_type(subj, expected_text="Child1[Unknown]")

        case Child2() as b1:
            reveal_type(b1, expected_text="Child2[Unknown, Unknown]")
            reveal_type(subj, expected_text="Child2[Unknown, Unknown]")


class TD1(TypedDict):
    x: int


def func12(subj: int, flt_cls: type[float], union_val: float | int):
    match subj:
        # This should generate an error because int doesn't accept two arguments.
        case int(1, 2):
            pass

    match subj:
        # This should generate an error because float doesn't accept keyword arguments.
        case float(x=1):
            pass

    match subj:
        case flt_cls():
            pass

        # This should generate an error because it is a union.
        case union_val():
            pass

        # This should generate an error because it is a TypedDict.
        case TD1():
            pass


def func13(subj: tuple[Literal[0]]):
    match subj:
        case tuple((1,)) as a:
            reveal_type(subj, expected_text="Never")
            reveal_type(a, expected_text="Never")

        case tuple((0, 0)) as b:
            reveal_type(subj, expected_text="Never")
            reveal_type(b, expected_text="Never")

        case tuple((0,)) as c:
            reveal_type(subj, expected_text="tuple[Literal[0]]")
            reveal_type(c, expected_text="tuple[Literal[0]]")

        case d:
            reveal_type(subj, expected_text="Never")
            reveal_type(d, expected_text="Never")


class ClassE(Generic[T]):
    __match_args__ = ("x",)
    x: list[T]


class ClassF(ClassE[T]):
    pass


def func14(subj: ClassE[T]) -> T | None:
    match subj:
        case ClassF(a):
            reveal_type(subj, expected_text="ClassF[T@func14]")
            reveal_type(a, expected_text="list[T@func14]")
            return a[0]


class IntPair(tuple[int, int]):
    pass


def func15(x: IntPair | None) -> None:
    match x:
        case IntPair((y, z)):
            reveal_type(y, expected_text="int")
            reveal_type(z, expected_text="int")


def func16(x: str | float | bool | None):
    match x:
        case str(v) | bool(v) | float(v):
            reveal_type(v, expected_text="str | bool | float")
            reveal_type(x, expected_text="str | bool | float")
        case v:
            reveal_type(v, expected_text="int | None")
            reveal_type(x, expected_text="int | None")
    reveal_type(x, expected_text="str | bool | float | int | None")


def func17(x: str | float | bool | None):
    match x:
        case str() | float() | bool():
            reveal_type(x, expected_text="str | float | bool")
        case _:
            reveal_type(x, expected_text="int | None")
    reveal_type(x, expected_text="str | float | bool | int | None")


def func18(x: str | float | bool | None):
    match x:
        case str(v) | float(v) | bool(v):
            reveal_type(v, expected_text="str | float | bool")
            reveal_type(x, expected_text="str | float | bool")
        case _:
            reveal_type(x, expected_text="int | None")
    reveal_type(x, expected_text="str | float | bool | int | None")


T5 = TypeVar("T5", complex, str)


def func19(x: T5) -> T5:
    match x:
        case complex():
            return x
        case str():
            return x

    reveal_type(x, expected_text="float* | int*")
    return x


T6 = TypeVar("T6", bound=complex | str)


def func20(x: T6) -> T6:
    match x:
        case complex():
            return x
        case str():
            return x

    reveal_type(x, expected_text="float* | int*")
    return x


@runtime_checkable
class Proto1(Protocol):
    x: int


class Proto2(Protocol):
    x: int


def func21(subj: object):
    match subj:
        case Proto1():
            pass

        # This should generate an error because Proto2 isn't runtime checkable.
        case Proto2():
            pass


class Impl1:
    x: int


def func22(subj: Proto1 | int):
    match subj:
        case Proto1():
            reveal_type(subj, expected_text="Proto1")

        case _:
            reveal_type(subj, expected_text="int")
