# This sample tests type checking for match statements (as
# described in PEP 634) that contain sequence patterns.

# pyright: reportMissingModuleSource=false

from enum import Enum
from typing import (
    Any,
    Generic,
    Iterator,
    List,
    Literal,
    Protocol,
    Reversible,
    Sequence,
    Tuple,
    TypeVar,
    Union,
)
from typing_extensions import TypeVarTuple, Unpack

Ts = TypeVarTuple("Ts")


def test_unknown(value_to_match):
    match value_to_match:
        case []:
            reveal_type(value_to_match, expected_text="Sequence[Unknown]")
        case a1, a2:
            reveal_type(a1, expected_text="Unknown")
            reveal_type(a2, expected_text="Unknown")

        case *b1, b2:
            reveal_type(b1, expected_text="list[Unknown]")
            reveal_type(b2, expected_text="Unknown")

        case c1, *c2:
            reveal_type(c1, expected_text="Unknown")
            reveal_type(c2, expected_text="list[Unknown]")

        case d1, *d2, d3:
            reveal_type(d1, expected_text="Unknown")
            reveal_type(d2, expected_text="list[Unknown]")
            reveal_type(d3, expected_text="Unknown")

        case 3, *e1:
            reveal_type(e1, expected_text="list[Unknown]")

        case "hi", *f1:
            reveal_type(f1, expected_text="list[Unknown]")

        case *g1, "hi":
            reveal_type(g1, expected_text="list[Unknown]")


def test_any(value_to_match: Any):
    match value_to_match:
        case []:
            reveal_type(value_to_match, expected_text="Sequence[Any]")
        case [*a1]:
            reveal_type(a1, expected_text="list[Any]")
        case b1:
            reveal_type(b1, expected_text="Any")


def test_reversible(value_to_match: Reversible[int]):
    match value_to_match:
        case [*a1]:
            reveal_type(a1, expected_text="list[int]")
        case b1:
            reveal_type(b1, expected_text="Reversible[int]")


_T_co = TypeVar("_T_co", covariant=True)


class SeqProto(Protocol[_T_co]):
    def __reversed__(self) -> Iterator[_T_co]: ...


def test_protocol(value_to_match: SeqProto[str]):
    match value_to_match:
        case [*a1]:
            reveal_type(a1, expected_text="list[str]")
        case b1:
            reveal_type(b1, expected_text="SeqProto[str]")


def test_list(value_to_match: List[str]):
    match value_to_match:
        case a1, a2:
            reveal_type(a1, expected_text="str")
            reveal_type(a2, expected_text="str")
            reveal_type(value_to_match, expected_text="List[str]")

        case *b1, b2:
            reveal_type(b1, expected_text="list[str]")
            reveal_type(b2, expected_text="str")
            reveal_type(value_to_match, expected_text="List[str]")

        case c1, *c2:
            reveal_type(c1, expected_text="str")
            reveal_type(c2, expected_text="list[str]")
            reveal_type(value_to_match, expected_text="List[str]")

        case d1, *d2, d3:
            reveal_type(d1, expected_text="str")
            reveal_type(d2, expected_text="list[str]")
            reveal_type(d3, expected_text="str")
            reveal_type(value_to_match, expected_text="List[str]")

        case 3, *e1:
            reveal_type(e1, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

        case "hi", *f1:
            reveal_type(f1, expected_text="list[str]")
            reveal_type(value_to_match, expected_text="List[str]")

        case *g1, "hi":
            reveal_type(g1, expected_text="list[str]")
            reveal_type(value_to_match, expected_text="List[str]")


def test_open_ended_tuple(value_to_match: Tuple[str, ...]):
    match value_to_match:
        case a1, a2:
            reveal_type(a1, expected_text="str")
            reveal_type(a2, expected_text="str")
            reveal_type(value_to_match, expected_text="tuple[str, str]")

        case *b1, b2:
            reveal_type(b1, expected_text="list[str]")
            reveal_type(b2, expected_text="str")
            reveal_type(value_to_match, expected_text="Tuple[str, ...]")

        case c1, *c2:
            reveal_type(c1, expected_text="str")
            reveal_type(c2, expected_text="list[str]")
            reveal_type(value_to_match, expected_text="Tuple[str, ...]")

        case d1, *d2, d3:
            reveal_type(d1, expected_text="str")
            reveal_type(d2, expected_text="list[str]")
            reveal_type(d3, expected_text="str")
            reveal_type(value_to_match, expected_text="Tuple[str, ...]")

        case 3, *e1:
            reveal_type(e1, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

        case "hi", *f1:
            reveal_type(f1, expected_text="list[str]")
            reveal_type(value_to_match, expected_text="Tuple[str, ...]")

        case *g1, "hi":
            reveal_type(g1, expected_text="list[str]")
            reveal_type(value_to_match, expected_text="Tuple[str, ...]")


def test_definite_tuple(value_to_match: Tuple[int, str, float, complex]):
    match value_to_match:
        case a1, a2, a3, a4 if value_to_match[0] == 0:
            reveal_type(a1, expected_text="int")
            reveal_type(a2, expected_text="str")
            reveal_type(a3, expected_text="float")
            reveal_type(a4, expected_text="complex")
            reveal_type(value_to_match, expected_text="tuple[int, str, float, complex]")

        case *b1, b2 if value_to_match[0] == 0:
            reveal_type(b1, expected_text="list[int | str | float]")
            reveal_type(b2, expected_text="complex")
            reveal_type(value_to_match, expected_text="Tuple[int, str, float, complex]")

        case c1, *c2 if value_to_match[0] == 0:
            reveal_type(c1, expected_text="int")
            reveal_type(c2, expected_text="list[str | float | complex]")
            reveal_type(value_to_match, expected_text="Tuple[int, str, float, complex]")

        case d1, *d2, d3 if value_to_match[0] == 0:
            reveal_type(d1, expected_text="int")
            reveal_type(d2, expected_text="list[str | float]")
            reveal_type(d3, expected_text="complex")
            reveal_type(value_to_match, expected_text="Tuple[int, str, float, complex]")

        case 3, *e1:
            reveal_type(e1, expected_text="list[str | float | complex]")
            reveal_type(value_to_match, expected_text="Tuple[int, str, float, complex]")

        case "hi", *f1:
            reveal_type(f1, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

        case *g1, 3j:
            reveal_type(g1, expected_text="list[int | str | float]")
            reveal_type(value_to_match, expected_text="Tuple[int, str, float, complex]")

        case *h1, "hi":
            reveal_type(h1, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")


def test_union(
    value_to_match: Union[
        Tuple[complex, complex],
        Tuple[int, str, float, complex],
        List[str],
        Tuple[float, ...],
        Any,
    ],
):
    match value_to_match:
        case a1, a2, a3, a4 if value_to_match[0] == 0:
            reveal_type(a1, expected_text="int | str | float | Any")
            reveal_type(a2, expected_text="str | float | Any")
            reveal_type(a3, expected_text="float | str | Any")
            reveal_type(a4, expected_text="complex | str | float | Any")
            reveal_type(
                value_to_match,
                expected_text="tuple[int, str, float, complex] | List[str] | tuple[float, float, float, float] | Sequence[Any]",
            )

        case *b1, b2 if value_to_match[0] == 0:
            reveal_type(
                b1,
                expected_text="list[complex] | list[int | str | float] | list[str] | list[float] | list[Any]",
            )
            reveal_type(b2, expected_text="complex | str | float | Any")
            reveal_type(
                value_to_match,
                expected_text="Tuple[complex, complex] | Tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Sequence[Any]",
            )

        case c1, *c2 if value_to_match[0] == 0:
            reveal_type(c1, expected_text="complex | int | str | float | Any")
            reveal_type(
                c2,
                expected_text="list[complex] | list[str | float | complex] | list[str] | list[float] | list[Any]",
            )
            reveal_type(
                value_to_match,
                expected_text="Tuple[complex, complex] | Tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Sequence[Any]",
            )

        case d1, *d2, d3 if value_to_match[0] == 0:
            reveal_type(d1, expected_text="complex | int | str | float | Any")
            reveal_type(
                d2,
                expected_text="list[Any] | list[str | float] | list[str] | list[float]",
            )
            reveal_type(d3, expected_text="complex | str | float | Any")
            reveal_type(
                value_to_match,
                expected_text="Tuple[complex, complex] | Tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Sequence[Any]",
            )

        case 3, e1:
            reveal_type(e1, expected_text="complex | float | Any")
            reveal_type(
                value_to_match,
                expected_text="tuple[Literal[3], complex] | tuple[Literal[3], float] | Sequence[Any]",
            )

        case "hi", *f1:
            reveal_type(f1, expected_text="list[str] | list[Any]")
            reveal_type(value_to_match, expected_text="List[str] | Sequence[Any]")

        case *g1, 3j:
            reveal_type(
                g1, expected_text="list[complex] | list[int | str | float] | list[Any]"
            )
            reveal_type(
                value_to_match,
                expected_text="tuple[complex, complex] | Tuple[int, str, float, complex] | Sequence[Any]",
            )

        case *h1, "hi":
            reveal_type(h1, expected_text="list[str] | list[Any]")
            reveal_type(value_to_match, expected_text="List[str] | Sequence[Any]")


class SupportsLessThan(Protocol):
    def __lt__(self, __other: Any) -> bool: ...

    def __le__(self, __other: Any) -> bool: ...


SupportsLessThanT = TypeVar("SupportsLessThanT", bound=SupportsLessThan)


def sort(seq: List[SupportsLessThanT]) -> List[SupportsLessThanT]:
    match seq:
        case [] | [_]:
            reveal_type(seq, expected_text="List[SupportsLessThanT@sort]")
            return seq

        case [x, y] if x <= y:
            reveal_type(seq, expected_text="List[SupportsLessThanT@sort]")
            return seq

        case [x, y]:
            reveal_type(seq, expected_text="List[SupportsLessThanT@sort]")
            return [y, x]

        case [x, y, z] if x <= y <= z:
            reveal_type(seq, expected_text="List[SupportsLessThanT@sort]")
            return seq

        case [x, y, z] if x > y > z:
            reveal_type(seq, expected_text="List[SupportsLessThanT@sort]")
            return [z, y, x]

        case [p, *rest]:
            a = sort([x for x in rest if x <= p])
            b = sort([x for x in rest if p < x])
            reveal_type(seq, expected_text="List[SupportsLessThanT@sort]")
            return a + [p] + b
    return seq


def test_exceptions(seq: Union[str, bytes, bytearray]):
    match seq:
        case [x, y]:
            reveal_type(x, expected_text="Never")
            reveal_type(y, expected_text="Never")
            return seq


def test_object1(seq: object):
    match seq:
        case (a1, a2) as a3:
            reveal_type(a1, expected_text="Unknown")
            reveal_type(a2, expected_text="Unknown")
            reveal_type(a3, expected_text="Sequence[Unknown]")
            reveal_type(seq, expected_text="Sequence[Unknown]")

        case (*b1, b2) as b3:
            reveal_type(b1, expected_text="list[Unknown]")
            reveal_type(b2, expected_text="Unknown")
            reveal_type(b3, expected_text="Sequence[Unknown]")
            reveal_type(seq, expected_text="Sequence[Unknown]")

        case (c1, *c2) as c3:
            reveal_type(c1, expected_text="Unknown")
            reveal_type(c2, expected_text="list[Unknown]")
            reveal_type(c3, expected_text="Sequence[Unknown]")
            reveal_type(seq, expected_text="Sequence[Unknown]")

        case (d1, *d2, d3) as d4:
            reveal_type(d1, expected_text="Unknown")
            reveal_type(d2, expected_text="list[Unknown]")
            reveal_type(d3, expected_text="Unknown")
            reveal_type(d4, expected_text="Sequence[Unknown]")
            reveal_type(seq, expected_text="Sequence[Unknown]")

        case (3, *e1) as e2:
            reveal_type(e1, expected_text="list[Unknown]")
            reveal_type(e2, expected_text="Sequence[Unknown]")
            reveal_type(seq, expected_text="Sequence[Unknown]")

        case ("hi", *f1) as f2:
            reveal_type(f1, expected_text="list[Unknown]")
            reveal_type(f2, expected_text="Sequence[Unknown]")
            reveal_type(seq, expected_text="Sequence[Unknown]")

        case (*g1, "hi") as g2:
            reveal_type(g1, expected_text="list[Unknown]")
            reveal_type(g2, expected_text="Sequence[Unknown]")
            reveal_type(seq, expected_text="Sequence[Unknown]")

        case [1, "hi", True] as h1:
            reveal_type(h1, expected_text="Sequence[int | str | bool]")
            reveal_type(seq, expected_text="Sequence[int | str | bool]")

        case [1, i1] as i2:
            reveal_type(i1, expected_text="Unknown")
            reveal_type(i2, expected_text="Sequence[Unknown]")
            reveal_type(seq, expected_text="Sequence[Unknown]")


def test_object2(value_to_match: object):
    match value_to_match:
        case [*a1]:
            reveal_type(a1, expected_text="list[Unknown]")
        case b1:
            reveal_type(b1, expected_text="object")


def test_sequence(value_to_match: Sequence[Any]):
    match value_to_match:
        case [*a1]:
            reveal_type(a1, expected_text="list[Any]")
        case b1:
            reveal_type(b1, expected_text="Never")


_T = TypeVar("_T")


class A(Generic[_T]):
    a: _T


class B: ...


class C: ...


AAlias = A

AInt = A[int]

BOrC = B | C


def test_illegal_type_alias(m: object):
    match m:
        case AAlias(a=i):
            pass

        # This should generate an error because it raises an
        # exception at runtime.
        case AInt(a=i):
            pass

        # This should generate an error because it raises an
        # exception at runtime.
        case BOrC(a=i):
            pass


def test_negative_narrowing1(subj: tuple[Literal[0]] | tuple[Literal[1]]):
    match subj:
        case (1, *a) | (*a):
            reveal_type(subj, expected_text="tuple[Literal[1]] | tuple[Literal[0]]")
            reveal_type(a, expected_text="list[Any] | list[int]")

        case b:
            reveal_type(subj, expected_text="Never")
            reveal_type(b, expected_text="Never")


def test_negative_narrowing2(subj: tuple[int, ...]):
    match subj:
        case (1, *a):
            reveal_type(subj, expected_text="tuple[int, ...]")
            reveal_type(a, expected_text="list[int]")

        case (b,):
            reveal_type(subj, expected_text="tuple[int]")
            reveal_type(b, expected_text="int")

        case (*c,):
            reveal_type(subj, expected_text="tuple[int, ...]")
            reveal_type(c, expected_text="list[int]")

        case d:
            reveal_type(subj, expected_text="Never")
            reveal_type(d, expected_text="Never")


def test_negative_narrowing3(subj: tuple[Any, Any]):
    match subj:
        case (a, b):
            reveal_type(a, expected_text="Any")
            reveal_type(b, expected_text="Any")

        case x:
            reveal_type(x, expected_text="Never")


def test_negative_narrowing4(a: str | None, b: str | None):
    match (a, b):
        case (None, _) as x:
            reveal_type(x, expected_text="tuple[None, str | None]")
        case (_, None) as x:
            reveal_type(x, expected_text="tuple[str, None]")
        case (a, b) as x:
            reveal_type(x, expected_text="tuple[str, str]")


def test_negative_narrowing5(a: str | None, b: str | None):
    match (a, b):
        case (None, _) | (_, None) as x:
            reveal_type(x, expected_text="tuple[None, str | None] | tuple[str, None]")
        case (a, b) as x:
            reveal_type(x, expected_text="tuple[str, str]")


def test_negative_narrowing6(a: str | None, b: str | None):
    match (a, b):
        case (None, None) as x:
            reveal_type(x, expected_text="tuple[None, None]")
            reveal_type(a, expected_text="None")
            reveal_type(b, expected_text="None")
        case (None, _) as x if 2 > 1:
            reveal_type(x, expected_text="tuple[None, str]")
            reveal_type(a, expected_text="None")
            reveal_type(b, expected_text="str")
        case (a, b) as x:
            reveal_type(
                x, expected_text="tuple[str, str | None] | tuple[str | None, str]"
            )
            reveal_type(a, expected_text="str | None")
            reveal_type(b, expected_text="str | None")


def test_negative_narrowing7(a: tuple[str, str] | str):
    match a:
        case (_, _):
            reveal_type(a, expected_text="tuple[str, str]")
        case _:
            reveal_type(a, expected_text="str")


def test_negative_narrowing8(a: str | int, b: str | int):
    t = a, b
    match t:
        case int(), int():
            reveal_type(t, expected_text="tuple[int, int]")
        case str(), int():
            reveal_type(t, expected_text="tuple[str, int]")
        case int(), str():
            reveal_type(t, expected_text="tuple[int, str]")
        case x, y:
            reveal_type(t, expected_text="tuple[str, str]")
            reveal_type(x, expected_text="str")
            reveal_type(y, expected_text="str")


class MyEnum(Enum):
    A = 1
    B = 2
    C = 3


def test_tuple_with_subpattern(
    subj: Literal[MyEnum.A]
    | tuple[Literal[MyEnum.B], int]
    | tuple[Literal[MyEnum.C], str],
):
    match subj:
        case MyEnum.A:
            reveal_type(subj, expected_text="Literal[MyEnum.A]")
        case (MyEnum.B, a):
            reveal_type(subj, expected_text="tuple[Literal[MyEnum.B], int]")
            reveal_type(a, expected_text="int")
        case (MyEnum.C, b):
            reveal_type(subj, expected_text="tuple[Literal[MyEnum.C], str]")
            reveal_type(b, expected_text="str")


def test_unbounded_tuple1(
    subj: tuple[int] | tuple[str, str] | tuple[int, Unpack[tuple[str, ...]], complex],
):
    match subj:
        case (x,):
            reveal_type(subj, expected_text="tuple[int]")
            reveal_type(x, expected_text="int")

        case (x, y):
            reveal_type(subj, expected_text="tuple[str, str] | tuple[int, complex]")
            reveal_type(x, expected_text="str | int")
            reveal_type(y, expected_text="str | complex")

        case (x, y, z):
            reveal_type(subj, expected_text="tuple[int, str, complex]")
            reveal_type(x, expected_text="int")
            reveal_type(y, expected_text="str")
            reveal_type(z, expected_text="complex")


def test_unbounded_tuple_2(subj: tuple[int, str, Unpack[tuple[range, ...]]]) -> None:
    match subj:
        case [1, *ts1]:
            reveal_type(ts1, expected_text="list[str | range]")

        case [1, "", *ts2]:
            reveal_type(ts2, expected_text="list[range]")


def test_unbounded_tuple_3(subj: tuple[int, ...]):
    match subj:
        case []:
            return
        case x:
            reveal_type(x, expected_text="tuple[int, ...]")


def test_unbounded_tuple_4(subj: tuple[str, ...]):
    match subj:
        case x, "":
            reveal_type(subj, expected_text="tuple[str, Literal['']]")
        case (x,):
            reveal_type(subj, expected_text="tuple[str]")
        case x:
            reveal_type(subj, expected_text="tuple[str, ...]")


def test_unbounded_tuple_5(subj: tuple[int, Unpack[tuple[str, ...]]]):
    match subj:
        case x, *rest:
            reveal_type(subj, expected_text="tuple[int, *tuple[str, ...]]")
            reveal_type(x, expected_text="int")
            reveal_type(rest, expected_text="list[str]")
        case x:
            reveal_type(x, expected_text="Never")


def test_unbounded_tuple_6(subj: tuple[str, ...]):
    match subj:
        case ("a", b, _, _):
            reveal_type(b, expected_text="str")

        case ("a", b, _, _, _):
            reveal_type(b, expected_text="str")

        case (_, b, _, _):
            reveal_type(b, expected_text="str")

        case (_, b, _, _, _):
            reveal_type(b, expected_text="str")

        case r:
            reveal_type(r, expected_text="tuple[str, ...]")


def test_variadic_tuple(subj: tuple[int, Unpack[Ts]]) -> tuple[Unpack[Ts]]:
    match subj:
        case _, *rest:
            reveal_type(rest, expected_text="list[Unknown]")
            return (*rest,)


class D:
    x: float
    y: float


def test_tuple_subexpressions(d: D):
    match (d.x, d.y):
        case (int(), int()):
            reveal_type(d.x, expected_text="int")
            reveal_type(d.y, expected_text="int")
