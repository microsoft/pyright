# This sample tests type checking for match statements (as
# described in PEP 634) that contain sequence patterns.

from typing import Any, List, Literal, Protocol, Tuple, TypeVar, Union

def test_unknown(value_to_match):
    match value_to_match:
        case a1, a2:
            t_a1: Literal["Unknown"] = reveal_type(a1)
            t_a2: Literal["Unknown"] = reveal_type(a2)

        case *b1, b2:
            t_b1: Literal["tuple[Unknown, ...]"] = reveal_type(b1)
            t_b2: Literal["Unknown"] = reveal_type(b2)

        case c1, *c2:
            t_c1: Literal["Unknown"] = reveal_type(c1)
            t_c2: Literal["tuple[Unknown, ...]"] = reveal_type(c2)

        case d1, *d2, d3:
            t_d1: Literal["Unknown"] = reveal_type(d1)
            t_d2: Literal["tuple[Unknown, ...]"] = reveal_type(d2)
            t_d3: Literal["Unknown"] = reveal_type(d3)
        
        case 3, *e1:
            t_e1: Literal["tuple[Unknown, ...]"] = reveal_type(e1)
       
        case "hi", *f1:
            t_f1: Literal["tuple[Unknown, ...]"] = reveal_type(f1)
       
        case *g1, "hi":
            t_g1: Literal["tuple[Unknown, ...]"] = reveal_type(g1)


def test_list(value_to_match: List[str]):
    match value_to_match:
        case a1, a2:
            t_a1: Literal["str"] = reveal_type(a1)
            t_a2: Literal["str"] = reveal_type(a2)
            t_v1: Literal["List[str]"] = reveal_type(value_to_match)

        case *b1, b2:
            t_b1: Literal["tuple[str, ...]"] = reveal_type(b1)
            t_b2: Literal["str"] = reveal_type(b2)
            t_v2: Literal["List[str]"] = reveal_type(value_to_match)

        case c1, *c2:
            t_c1: Literal["str"] = reveal_type(c1)
            t_c2: Literal["tuple[str, ...]"] = reveal_type(c2)
            t_v3: Literal["List[str]"] = reveal_type(value_to_match)

        case d1, *d2, d3:
            t_d1: Literal["str"] = reveal_type(d1)
            t_d2: Literal["tuple[str, ...]"] = reveal_type(d2)
            t_d3: Literal["str"] = reveal_type(d3)
            t_v4: Literal["List[str]"] = reveal_type(value_to_match)
        
        case 3, *e1:
            t_e1: Literal["Never"] = reveal_type(e1)
            t_v5: Literal["Never"] = reveal_type(value_to_match)
       
        case "hi", *f1:
            t_f1: Literal["tuple[str, ...]"] = reveal_type(f1)
            t_v6: Literal["List[str]"] = reveal_type(value_to_match)
       
        case *g1, "hi":
            t_g1: Literal["tuple[str, ...]"] = reveal_type(g1)
            t_v7: Literal["List[str]"] = reveal_type(value_to_match)

def test_open_ended_tuple(value_to_match: Tuple[str, ...]):
    match value_to_match:
        case a1, a2:
            t_a1: Literal["str"] = reveal_type(a1)
            t_a2: Literal["str"] = reveal_type(a2)
            t_v1: Literal["tuple[str, str]"] = reveal_type(value_to_match)

        case *b1, b2:
            t_b1: Literal["tuple[str, ...]"] = reveal_type(b1)
            t_b2: Literal["str"] = reveal_type(b2)
            t_v2: Literal["Tuple[str, ...]"] = reveal_type(value_to_match)

        case c1, *c2:
            t_c1: Literal["str"] = reveal_type(c1)
            t_c2: Literal["tuple[str, ...]"] = reveal_type(c2)
            t_v3: Literal["Tuple[str, ...]"] = reveal_type(value_to_match)

        case d1, *d2, d3:
            t_d1: Literal["str"] = reveal_type(d1)
            t_d2: Literal["tuple[str, ...]"] = reveal_type(d2)
            t_d3: Literal["str"] = reveal_type(d3)
            t_v4: Literal["Tuple[str, ...]"] = reveal_type(value_to_match)
        
        case 3, *e1:
            t_e1: Literal["Never"] = reveal_type(e1)
            t_v5: Literal["Never"] = reveal_type(value_to_match)
       
        case "hi", *f1:
            t_f1: Literal["tuple[str, ...]"] = reveal_type(f1)
            t_v6: Literal["Tuple[str, ...]"] = reveal_type(value_to_match)
       
        case *g1, "hi":
            t_g1: Literal["tuple[str, ...]"] = reveal_type(g1)
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
            t_b1: Literal["tuple[int, str, float]"] = reveal_type(b1)
            t_b2: Literal["complex"] = reveal_type(b2)
            t_v2: Literal["tuple[int, str, float, complex]"] = reveal_type(value_to_match)

        case c1, *c2:
            t_c1: Literal["int"] = reveal_type(c1)
            t_c2: Literal["tuple[str, float, complex]"] = reveal_type(c2)
            t_v3: Literal["tuple[int, str, float, complex]"] = reveal_type(value_to_match)

        case d1, *d2, d3:
            t_d1: Literal["int"] = reveal_type(d1)
            t_d2: Literal["tuple[str, float]"] = reveal_type(d2)
            t_d3: Literal["complex"] = reveal_type(d3)
            t_v4: Literal["tuple[int, str, float, complex]"] = reveal_type(value_to_match)
        
        case 3, *e1:
            t_e1: Literal["tuple[str, float, complex]"] = reveal_type(e1)
            t_v5: Literal["tuple[Literal[3], str, float, complex]"] = reveal_type(value_to_match)
       
        case "hi", *f1:
            t_f1: Literal["Never"] = reveal_type(f1)
            t_v6: Literal["Never"] = reveal_type(value_to_match)

        case *g1, 3j:
            t_g1: Literal["tuple[int, str, float]"] = reveal_type(g1)
            t_v7: Literal["tuple[int, str, float, complex]"] = reveal_type(value_to_match)
       
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
            t_b1: Literal["tuple[complex] | tuple[int, str, float] | tuple[str, ...] | tuple[float, ...] | tuple[Any, ...]"] = reveal_type(b1)
            t_b2: Literal["complex | str | float | Any"] = reveal_type(b2)
            t_v2: Literal["tuple[complex, complex] | tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Any"] = reveal_type(value_to_match)

        case c1, *c2:
            t_c1: Literal["complex | int | str | float | Any"] = reveal_type(c1)
            t_c2: Literal["tuple[complex] | tuple[str, float, complex] | tuple[str, ...] | tuple[float, ...] | tuple[Any, ...]"] = reveal_type(c2)
            t_v3: Literal["tuple[complex, complex] | tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Any"] = reveal_type(value_to_match)

        case d1, *d2, d3:
            t_d1: Literal["complex | int | str | float | Any"] = reveal_type(d1)
            t_d2: Literal["tuple[()] | tuple[str, float] | tuple[str, ...] | tuple[float, ...] | tuple[Any, ...]"] = reveal_type(d2)
            t_d3: Literal["complex | str | float | Any"] = reveal_type(d3)
            t_v4: Literal["tuple[complex, complex] | tuple[int, str, float, complex] | List[str] | Tuple[float, ...] | Any"] = reveal_type(value_to_match)
        
        case 3, e1:
            t_e1: Literal["complex | float | Any"] = reveal_type(e1)
            t_v5: Literal["tuple[Literal[3], complex] | tuple[Literal[3], float] | Any"] = reveal_type(value_to_match)
       
        case "hi", *f1:
            t_f1: Literal["tuple[str, ...] | tuple[Any, ...]"] = reveal_type(f1)
            t_v6: Literal["List[str] | Any"] = reveal_type(value_to_match)
       
        case *g1, 3j:
            t_g1: Literal["tuple[complex] | tuple[int, str, float] | tuple[Any, ...]"] = reveal_type(g1)
            t_v7: Literal["tuple[complex, complex] | tuple[int, str, float, complex] | Any"] = reveal_type(value_to_match)
       
        case *h1, "hi":
            t_h1: Literal["tuple[str, ...] | tuple[Any, ...]"] = reveal_type(h1)
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

