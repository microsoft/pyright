# This sample tests type checking for match statements (as
# described in PEP 634) that contain sequence patterns.

from typing import Any, Generic, List, Protocol, Tuple, TypeVar, Union

def test_unknown(value_to_match):
    match value_to_match:
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
        case a1, a2, a3, a4:
            reveal_type(a1, expected_text="int")
            reveal_type(a2, expected_text="str")
            reveal_type(a3, expected_text="float")
            reveal_type(a4, expected_text="complex")
            reveal_type(value_to_match, expected_text="tuple[int, str, float, complex]")

        case *b1, b2:
            reveal_type(b1, expected_text="list[int | str | float]")
            reveal_type(b2, expected_text="complex")
            reveal_type(value_to_match, expected_text="Tuple[int, str, float, complex]")

        case c1, *c2:
            reveal_type(c1, expected_text="int")
            reveal_type(c2, expected_text="list[str | float | complex]")
            reveal_type(value_to_match, expected_text="Tuple[int, str, float, complex]")

        case d1, *d2, d3:
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


def test_union(value_to_match: Union[Tuple[complex, complex], Tuple[int, str, float, complex], List[str], Tuple[float, ...], Any]):
    match value_to_match:
        case a1, a2, a3, a4:
            reveal_type(a1, expected_text="int | str | float | Any")
            reveal_type(a2, expected_text="str | float | Any")
            reveal_type(a3, expected_text="float | str | Any")
            reveal_type(a4, expected_text="complex | str | float | Any")
            reveal_type(value_to_match, expected_text="tuple[int, str, float, complex] | List[str] | tuple[float, float, float, float] | Any")

        case *b1, b2:
            reveal_type(b1, expected_text="list[complex] | list[int | str | float] | list[str] | list[float] | list[Any]")
            reveal_type(b2, expected_text="complex | str | float | Any")
            reveal_type(value_to_match, expected_text="Tuple[complex, complex] | Tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Any")

        case c1, *c2:
            reveal_type(c1, expected_text="complex | int | str | float | Any")
            reveal_type(c2, expected_text="list[complex] | list[str | float | complex] | list[str] | list[float] | list[Any]")
            reveal_type(value_to_match, expected_text="Tuple[complex, complex] | Tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Any")

        case d1, *d2, d3:
            reveal_type(d1, expected_text="complex | int | str | float | Any")
            reveal_type(d2, expected_text="list[str | float] | list[str] | list[float] | list[Any]")
            reveal_type(d3, expected_text="complex | str | float | Any")
            reveal_type(value_to_match, expected_text="Tuple[complex, complex] | Tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Any")
        
        case 3, e1:
            reveal_type(e1, expected_text="complex | float | Any")
            reveal_type(value_to_match, expected_text="tuple[Literal[3], complex] | tuple[Literal[3], float] | Any")
       
        case "hi", *f1:
            reveal_type(f1, expected_text="list[str] | list[Any]")
            reveal_type(value_to_match, expected_text="List[str] | Any")
       
        case *g1, 3j:
            reveal_type(g1, expected_text="list[complex] | list[int | str | float] | list[Any]")
            reveal_type(value_to_match, expected_text="Tuple[complex, complex] | Tuple[int, str, float, complex] | Any")
       
        case *h1, "hi":
            reveal_type(h1, expected_text="list[str] | list[Any]")
            reveal_type(value_to_match, expected_text="List[str] | Any")


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

def test_object(seq: object):
    match seq:
        case (a1, a2) as a3:
            reveal_type(a1, expected_text="object")
            reveal_type(a2, expected_text="object")
            reveal_type(a3, expected_text="Sequence[object]")
            reveal_type(seq, expected_text="Sequence[object]")

        case (*b1, b2) as b3:
            reveal_type(b1, expected_text="list[object]")
            reveal_type(b2, expected_text="object")
            reveal_type(b3, expected_text="Sequence[object]")
            reveal_type(seq, expected_text="Sequence[object]")

        case (c1, *c2) as c3:
            reveal_type(c1, expected_text="object")
            reveal_type(c2, expected_text="list[object]")
            reveal_type(c3, expected_text="Sequence[object]")
            reveal_type(seq, expected_text="Sequence[object]")

        case (d1, *d2, d3) as d4:
            reveal_type(d1, expected_text="object")
            reveal_type(d2, expected_text="list[object]")
            reveal_type(d3, expected_text="object")
            reveal_type(d4, expected_text="Sequence[object]")
            reveal_type(seq, expected_text="Sequence[object]")
        
        case (3, *e1) as e2:
            reveal_type(e1, expected_text="list[object]")
            reveal_type(e2, expected_text="Sequence[object | int]")
            reveal_type(seq, expected_text="Sequence[object | int]")
        
        case ("hi", *f1) as f2: 
            reveal_type(f1, expected_text="list[object]")
            reveal_type(f2, expected_text="Sequence[object | str]")
            reveal_type(seq, expected_text="Sequence[object | str]") 
       
        case (*g1, "hi") as g2:
            reveal_type(g1, expected_text="list[object]")
            reveal_type(g2, expected_text="Sequence[object | str]") 
            reveal_type(seq, expected_text="Sequence[object | str]") 

        case [1, "hi", True] as h1: 
            reveal_type(h1, expected_text="Sequence[int | str | bool]")
            reveal_type(seq, expected_text="Sequence[int | str | bool]")

        case [1, i1] as i2:
            reveal_type(i1, expected_text="object")
            reveal_type(i2, expected_text="Sequence[object | int]") 
            reveal_type(seq, expected_text="Sequence[object | int]")

_T = TypeVar('_T')

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
