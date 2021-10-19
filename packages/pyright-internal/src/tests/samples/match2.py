# This sample tests type checking for match statements (as
# described in PEP 634) that contain sequence patterns.

from typing import Any, Generic, List, Literal, Protocol, Tuple, TypeVar, Union

def test_unknown(value_to_match):
    match value_to_match:
        case a1, a2:
            t_a1: Literal["Unknown"] = reveal_type(a1)
            t_a2: Literal["Unknown"] = reveal_type(a2)

        case *b1, b2:
            t_b1: Literal["list[Unknown]"] = reveal_type(b1)
            t_b2: Literal["Unknown"] = reveal_type(b2)

        case c1, *c2:
            t_c1: Literal["Unknown"] = reveal_type(c1)
            t_c2: Literal["list[Unknown]"] = reveal_type(c2)

        case d1, *d2, d3:
            t_d1: Literal["Unknown"] = reveal_type(d1)
            t_d2: Literal["list[Unknown]"] = reveal_type(d2)
            t_d3: Literal["Unknown"] = reveal_type(d3)
        
        case 3, *e1:
            t_e1: Literal["list[Unknown]"] = reveal_type(e1)
       
        case "hi", *f1:
            t_f1: Literal["list[Unknown]"] = reveal_type(f1)
       
        case *g1, "hi":
            t_g1: Literal["list[Unknown]"] = reveal_type(g1)


def test_list(value_to_match: List[str]):
    match value_to_match:
        case a1, a2:
            t_a1: Literal["str"] = reveal_type(a1)
            t_a2: Literal["str"] = reveal_type(a2)
            t_v1: Literal["List[str]"] = reveal_type(value_to_match)

        case *b1, b2:
            t_b1: Literal["list[str]"] = reveal_type(b1)
            t_b2: Literal["str"] = reveal_type(b2)
            t_v2: Literal["List[str]"] = reveal_type(value_to_match)

        case c1, *c2:
            t_c1: Literal["str"] = reveal_type(c1)
            t_c2: Literal["list[str]"] = reveal_type(c2)
            t_v3: Literal["List[str]"] = reveal_type(value_to_match)

        case d1, *d2, d3:
            t_d1: Literal["str"] = reveal_type(d1)
            t_d2: Literal["list[str]"] = reveal_type(d2)
            t_d3: Literal["str"] = reveal_type(d3)
            t_v4: Literal["List[str]"] = reveal_type(value_to_match)
        
        case 3, *e1:
            t_e1: Literal["Never"] = reveal_type(e1)
            t_v5: Literal["Never"] = reveal_type(value_to_match)
       
        case "hi", *f1:
            t_f1: Literal["list[str]"] = reveal_type(f1)
            t_v6: Literal["List[str]"] = reveal_type(value_to_match)
       
        case *g1, "hi":
            t_g1: Literal["list[str]"] = reveal_type(g1)
            t_v7: Literal["List[str]"] = reveal_type(value_to_match)

def test_open_ended_tuple(value_to_match: Tuple[str, ...]):
    match value_to_match:
        case a1, a2:
            t_a1: Literal["str"] = reveal_type(a1)
            t_a2: Literal["str"] = reveal_type(a2)
            t_v1: Literal["tuple[str, str]"] = reveal_type(value_to_match)

        case *b1, b2:
            t_b1: Literal["list[str]"] = reveal_type(b1)
            t_b2: Literal["str"] = reveal_type(b2)
            t_v2: Literal["Tuple[str, ...]"] = reveal_type(value_to_match)

        case c1, *c2:
            t_c1: Literal["str"] = reveal_type(c1)
            t_c2: Literal["list[str]"] = reveal_type(c2)
            t_v3: Literal["Tuple[str, ...]"] = reveal_type(value_to_match)

        case d1, *d2, d3:
            t_d1: Literal["str"] = reveal_type(d1)
            t_d2: Literal["list[str]"] = reveal_type(d2)
            t_d3: Literal["str"] = reveal_type(d3)
            t_v4: Literal["Tuple[str, ...]"] = reveal_type(value_to_match)
        
        case 3, *e1:
            t_e1: Literal["Never"] = reveal_type(e1)
            t_v5: Literal["Never"] = reveal_type(value_to_match)
       
        case "hi", *f1:
            t_f1: Literal["list[str]"] = reveal_type(f1)
            t_v6: Literal["Tuple[str, ...]"] = reveal_type(value_to_match)
       
        case *g1, "hi":
            t_g1: Literal["list[str]"] = reveal_type(g1)
            t_v7: Literal["Tuple[str, ...]"] = reveal_type(value_to_match)

def test_definite_tuple(value_to_match: Tuple[int, str, float, complex]):
    match value_to_match:
        case a1, a2, a3, a4:
            t_a1: Literal["int"] = reveal_type(a1)
            t_a2: Literal["str"] = reveal_type(a2)
            t_a3: Literal["float"] = reveal_type(a3)
            t_a4: Literal["complex"] = reveal_type(a4)
            t_v1: Literal["tuple[int, str, float, complex]"] = reveal_type(value_to_match)

        case *b1, b2:
            t_b1: Literal["list[int | str | float]"] = reveal_type(b1)
            t_b2: Literal["complex"] = reveal_type(b2)
            t_v2: Literal["Tuple[int, str, float, complex]"] = reveal_type(value_to_match)

        case c1, *c2:
            t_c1: Literal["int"] = reveal_type(c1)
            t_c2: Literal["list[str | float | complex]"] = reveal_type(c2)
            t_v3: Literal["Tuple[int, str, float, complex]"] = reveal_type(value_to_match)

        case d1, *d2, d3:
            t_d1: Literal["int"] = reveal_type(d1)
            t_d2: Literal["list[str | float]"] = reveal_type(d2)
            t_d3: Literal["complex"] = reveal_type(d3)
            t_v4: Literal["Tuple[int, str, float, complex]"] = reveal_type(value_to_match)
        
        case 3, *e1:
            t_e1: Literal["list[str | float | complex]"] = reveal_type(e1)
            t_v5: Literal["Tuple[int, str, float, complex]"] = reveal_type(value_to_match)
       
        case "hi", *f1:
            t_f1: Literal["Never"] = reveal_type(f1)
            t_v6: Literal["Never"] = reveal_type(value_to_match)

        case *g1, 3j:
            t_g1: Literal["list[int | str | float]"] = reveal_type(g1)
            t_v7: Literal["Tuple[int, str, float, complex]"] = reveal_type(value_to_match)
       
        case *h1, "hi":
            t_h1: Literal["Never"] = reveal_type(h1)
            t_v8: Literal["Never"] = reveal_type(value_to_match)


def test_union(value_to_match: Union[Tuple[complex, complex], Tuple[int, str, float, complex], List[str], Tuple[float, ...], Any]):
    match value_to_match:
        case a1, a2, a3, a4:
            t_a1: Literal["int | str | float | Any"] = reveal_type(a1)
            t_a2: Literal["str | float | Any"] = reveal_type(a2)
            t_a3: Literal["float | str | Any"] = reveal_type(a3)
            t_a4: Literal["complex | str | float | Any"] = reveal_type(a4)
            t_v1: Literal["tuple[int, str, float, complex] | List[str] | tuple[float, float, float, float] | Any"] = reveal_type(value_to_match)

        case *b1, b2:
            t_b1: Literal["list[complex] | list[int | str | float] | list[str] | list[float] | list[Any]"] = reveal_type(b1)
            t_b2: Literal["complex | str | float | Any"] = reveal_type(b2)
            t_v2: Literal["Tuple[complex, complex] | Tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Any"] = reveal_type(value_to_match)

        case c1, *c2:
            t_c1: Literal["complex | int | str | float | Any"] = reveal_type(c1)
            t_c2: Literal["list[complex] | list[str | float | complex] | list[str] | list[float] | list[Any]"] = reveal_type(c2)
            t_v3: Literal["Tuple[complex, complex] | Tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Any"] = reveal_type(value_to_match)

        case d1, *d2, d3:
            t_d1: Literal["complex | int | str | float | Any"] = reveal_type(d1)
            t_d2: Literal["list[str | float] | list[str] | list[float] | list[Any]"] = reveal_type(d2)
            t_d3: Literal["complex | str | float | Any"] = reveal_type(d3)
            t_v4: Literal["Tuple[complex, complex] | Tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Any"] = reveal_type(value_to_match)
        
        case 3, e1:
            t_e1: Literal["complex | float | Any"] = reveal_type(e1)
            t_v5: Literal["tuple[Literal[3], complex] | tuple[Literal[3], float] | Any"] = reveal_type(value_to_match)
       
        case "hi", *f1:
            t_f1: Literal["list[str] | list[Any]"] = reveal_type(f1)
            t_v6: Literal["List[str] | Any"] = reveal_type(value_to_match)
       
        case *g1, 3j:
            t_g1: Literal["list[complex] | list[int | str | float] | list[Any]"] = reveal_type(g1)
            t_v7: Literal["Tuple[complex, complex] | Tuple[int, str, float, complex] | Any"] = reveal_type(value_to_match)
       
        case *h1, "hi":
            t_h1: Literal["list[str] | list[Any]"] = reveal_type(h1)
            t_v8: Literal["List[str] | Any"] = reveal_type(value_to_match)


class SupportsLessThan(Protocol):
    def __lt__(self, __other: Any) -> bool: ...
    def __le__(self, __other: Any) -> bool: ...

SupportsLessThanT = TypeVar("SupportsLessThanT", bound=SupportsLessThan)


def sort(seq: List[SupportsLessThanT]) -> List[SupportsLessThanT]:
    match seq:
        case [] | [_]:
            t_v1: Literal["List[SupportsLessThanT@sort]"] = reveal_type(seq)
            return seq
        
        case [x, y] if x <= y:
            t_v2: Literal["List[SupportsLessThanT@sort]"] = reveal_type(seq)
            return seq
        
        case [x, y]:
            t_v3: Literal["List[SupportsLessThanT@sort]"] = reveal_type(seq)
            return [y, x]
        
        case [x, y, z] if x <= y <= z:
            t_v4: Literal["List[SupportsLessThanT@sort]"] = reveal_type(seq)
            return seq
        
        case [x, y, z] if x > y > z:
            t_v5: Literal["List[SupportsLessThanT@sort]"] = reveal_type(seq)
            return [z, y, x]
        
        case [p, *rest]:
            a = sort([x for x in rest if x <= p])
            b = sort([x for x in rest if p < x])
            t_v6: Literal["List[SupportsLessThanT@sort]"] = reveal_type(seq)
            return a + [p] + b
    return seq


def test_exceptions(seq: Union[str, bytes, bytearray]):
    match seq:
        case [x, y]:
            t_v1: Literal["Never"] = reveal_type(x)
            t_v2: Literal["Never"] = reveal_type(y)
            return seq

def test_object(seq: object):
    match seq:
        case (a1, a2) as a3:
            t_a1: Literal["object"] = reveal_type(a1)
            t_a2: Literal["object"] = reveal_type(a2)
            t_a3: Literal["Sequence[object]"] = reveal_type(a3)
            t_va: Literal["Sequence[object]"] = reveal_type(seq)

        case (*b1, b2) as b3:
            t_b1: Literal["list[object]"] = reveal_type(b1)
            t_b2: Literal["object"] = reveal_type(b2)
            t_b3: Literal["Sequence[object]"] = reveal_type(b3)
            t_vb: Literal["Sequence[object]"] = reveal_type(seq)

        case (c1, *c2) as c3:
            t_c1: Literal["object"] = reveal_type(c1)
            t_c2: Literal["list[object]"] = reveal_type(c2)
            t_c3: Literal["Sequence[object]"] = reveal_type(c3)
            t_vc: Literal["Sequence[object]"] = reveal_type(seq)

        case (d1, *d2, d3) as d4:
            t_d1: Literal["object"] = reveal_type(d1)
            t_d2: Literal["list[object]"] = reveal_type(d2)
            t_d3: Literal["object"] = reveal_type(d3)
            t_d4: Literal["Sequence[object]"] = reveal_type(d4)
            t_vd: Literal["Sequence[object]"] = reveal_type(seq)
        
        case (3, *e1) as e2:
            t_e1: Literal["list[object]"] = reveal_type(e1)
            t_e2: Literal["Sequence[object | int]"] = reveal_type(e2)
            t_ve: Literal["Sequence[object | int]"] = reveal_type(seq)
        
        case ("hi", *f1) as f2: 
            t_f1: Literal["list[object]"] = reveal_type(f1)
            t_f2: Literal["Sequence[object | str]"] = reveal_type(f2)
            t_vf: Literal["Sequence[object | str]"] = reveal_type(seq) 
       
        case (*g1, "hi") as g2:
            t_g1: Literal["list[object]"] = reveal_type(g1)
            t_g2: Literal["Sequence[object | str]"] = reveal_type(g2) 
            t_vg: Literal["Sequence[object | str]"] = reveal_type(seq) 

        case [1, "hi", True] as h1: 
            t_h1: Literal["Sequence[int | str | bool]"] = reveal_type(h1)
            t_vh: Literal["Sequence[int | str | bool]"] = reveal_type(seq)

        case [1, i1] as i2:
            t_i1: Literal["object"] = reveal_type(i1)
            t_i2: Literal["Sequence[object | int]"] = reveal_type(i2) 
            t_vi: Literal["Sequence[object | int]"] = reveal_type(seq)

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
