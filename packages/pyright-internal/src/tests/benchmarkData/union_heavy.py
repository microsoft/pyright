# union_heavy.py — complex union/intersection type scenarios
# Stresses the type evaluator's union handling, narrowing, and type guard paths.

from __future__ import annotations

from typing import (
    Any,
    Dict,
    Generic,
    List,
    Literal,
    Never,
    Optional,
    Protocol,
    Sequence,
    Tuple,
    TypeAlias,
    TypeGuard,
    TypeVar,
    Union,
    overload,
    runtime_checkable,
)
from dataclasses import dataclass

_T = TypeVar("_T")

# --- Large literal unions ---

HttpStatus: TypeAlias = Literal[
    100, 101, 102, 103,
    200, 201, 202, 203, 204, 205, 206, 207, 208, 226,
    300, 301, 302, 303, 304, 305, 307, 308,
    400, 401, 402, 403, 404, 405, 406, 407, 408, 409,
    410, 411, 412, 413, 414, 415, 416, 417, 418, 421,
    422, 423, 424, 425, 426, 428, 429, 431, 451,
    500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
]

Color: TypeAlias = Literal[
    "red", "green", "blue", "yellow", "cyan", "magenta",
    "white", "black", "gray", "grey", "orange", "purple",
    "pink", "brown", "gold", "silver", "navy", "teal",
    "maroon", "olive", "lime", "aqua", "coral", "salmon",
    "crimson", "indigo", "violet", "turquoise", "khaki",
    "orchid", "plum", "sienna", "tomato", "wheat",
]

Country: TypeAlias = Literal[
    "US", "UK", "CA", "AU", "NZ", "IE", "DE", "FR", "ES", "IT",
    "PT", "NL", "BE", "CH", "AT", "SE", "NO", "DK", "FI", "PL",
    "CZ", "SK", "HU", "RO", "BG", "HR", "SI", "EE", "LV", "LT",
    "JP", "KR", "CN", "TW", "HK", "SG", "MY", "TH", "VN", "PH",
    "IN", "PK", "BD", "LK", "NP", "ID", "BR", "AR", "CL", "CO",
    "MX", "PE", "VE", "EC", "UY", "PY", "BO", "ZA", "NG", "KE",
    "EG", "MA", "TN", "GH", "ET", "TZ", "UG", "RW", "SN", "CI",
]

# --- Discriminated unions ---

@dataclass
class Circle:
    kind: Literal["circle"] = "circle"
    radius: float = 1.0


@dataclass
class Rectangle:
    kind: Literal["rectangle"] = "rectangle"
    width: float = 1.0
    height: float = 1.0


@dataclass
class Triangle:
    kind: Literal["triangle"] = "triangle"
    base: float = 1.0
    height: float = 1.0


@dataclass
class Polygon:
    kind: Literal["polygon"] = "polygon"
    sides: int = 3
    side_length: float = 1.0


@dataclass
class Ellipse:
    kind: Literal["ellipse"] = "ellipse"
    semi_major: float = 2.0
    semi_minor: float = 1.0


Shape = Union[Circle, Rectangle, Triangle, Polygon, Ellipse]


def area(shape: Shape) -> float:
    if shape.kind == "circle":
        return 3.14159 * shape.radius ** 2
    elif shape.kind == "rectangle":
        return shape.width * shape.height
    elif shape.kind == "triangle":
        return 0.5 * shape.base * shape.height
    elif shape.kind == "polygon":
        import math
        return (shape.sides * shape.side_length ** 2) / (4 * math.tan(math.pi / shape.sides))
    elif shape.kind == "ellipse":
        return 3.14159 * shape.semi_major * shape.semi_minor
    else:
        _: Never = shape
        raise ValueError(f"Unknown shape: {shape}")


def perimeter(shape: Shape) -> float:
    if shape.kind == "circle":
        return 2 * 3.14159 * shape.radius
    elif shape.kind == "rectangle":
        return 2 * (shape.width + shape.height)
    elif shape.kind == "triangle":
        return shape.base * 3
    elif shape.kind == "polygon":
        return shape.sides * shape.side_length
    elif shape.kind == "ellipse":
        import math
        a = shape.semi_major
        b = shape.semi_minor
        return 3.14159 * (3 * (a + b) - math.sqrt((3 * a + b) * (a + 3 * b)))
    else:
        _: Never = shape
        raise ValueError


# --- Nested unions ---

JsonPrimitive = Union[str, int, float, bool, None]
JsonArray = List["JsonValue"]
JsonObject = Dict[str, "JsonValue"]
JsonValue = Union[JsonPrimitive, JsonArray, JsonObject]


def json_depth(value: JsonValue) -> int:
    if isinstance(value, dict):
        if not value:
            return 1
        return 1 + max(json_depth(v) for v in value.values())
    elif isinstance(value, list):
        if not value:
            return 1
        return 1 + max(json_depth(v) for v in value)
    else:
        return 0


def json_size(value: JsonValue) -> int:
    if isinstance(value, dict):
        return sum(json_size(v) for v in value.values()) + len(value)
    elif isinstance(value, list):
        return sum(json_size(v) for v in value) + len(value)
    elif isinstance(value, str):
        return len(value)
    elif value is None:
        return 0
    else:
        return 1


# --- Union narrowing stress ---

def narrow_union_1(x: Union[int, str, float, bool, bytes, None]) -> str:
    if isinstance(x, int):
        return f"int: {x}"
    elif isinstance(x, str):
        return f"str: {x}"
    elif isinstance(x, float):
        return f"float: {x}"
    elif isinstance(x, bool):
        return f"bool: {x}"
    elif isinstance(x, bytes):
        return f"bytes: {x!r}"
    elif x is None:
        return "none"
    else:
        _: Never = x
        return "unreachable"


def narrow_union_2(
    x: Union[int, str, List[int], Dict[str, int], Tuple[int, ...], set, frozenset],
) -> int:
    if isinstance(x, int):
        return x
    elif isinstance(x, str):
        return len(x)
    elif isinstance(x, list):
        return sum(x)
    elif isinstance(x, dict):
        return sum(x.values())
    elif isinstance(x, tuple):
        return sum(x)
    elif isinstance(x, set):
        return len(x)
    elif isinstance(x, frozenset):
        return len(x)
    else:
        _: Never = x
        raise ValueError


def narrow_union_chained(
    x: Union[int, str, float, bytes, list, dict, tuple, set, frozenset, None],
) -> str:
    if x is None:
        return "None"
    if isinstance(x, (int, float)):
        return f"number: {x}"
    if isinstance(x, (str, bytes)):
        return f"text: {x!r}"
    if isinstance(x, (list, tuple)):
        return f"sequence: len={len(x)}"
    if isinstance(x, (set, frozenset)):
        return f"set: len={len(x)}"
    if isinstance(x, dict):
        return f"dict: keys={len(x)}"
    _: Never = x
    return "unreachable"


# --- Type guards ---

def is_string_list(val: List[Any]) -> TypeGuard[List[str]]:
    return all(isinstance(item, str) for item in val)


def is_int_dict(val: Dict[str, Any]) -> TypeGuard[Dict[str, int]]:
    return all(isinstance(v, int) for v in val.values())


def is_non_empty(val: Optional[List[_T]]) -> TypeGuard[List[_T]]:
    return val is not None and len(val) > 0


def is_positive_int(val: Union[int, str, None]) -> TypeGuard[int]:
    return isinstance(val, int) and val > 0


# --- Overloaded functions with union args ---

@overload
def transform(value: int) -> str: ...
@overload
def transform(value: str) -> int: ...
@overload
def transform(value: float) -> bool: ...
@overload
def transform(value: bool) -> float: ...
@overload
def transform(value: bytes) -> List[int]: ...
@overload
def transform(value: List[int]) -> bytes: ...
@overload
def transform(value: None) -> Literal["none"]: ...


def transform(
    value: Union[int, str, float, bool, bytes, List[int], None],
) -> Union[str, int, bool, float, List[int], bytes, Literal["none"]]:
    if isinstance(value, bool):
        return float(value)
    elif isinstance(value, int):
        return str(value)
    elif isinstance(value, str):
        return len(value)
    elif isinstance(value, float):
        return value > 0
    elif isinstance(value, bytes):
        return list(value)
    elif isinstance(value, list):
        return bytes(value)
    elif value is None:
        return "none"
    else:
        raise TypeError


# --- Complex generic unions ---

@dataclass
class Success(Generic[_T]):
    value: _T


@dataclass
class Failure:
    error: str
    code: int = 0


Result = Union[Success[_T], Failure]


def handle_result(r: Result[int]) -> str:
    if isinstance(r, Success):
        return f"OK: {r.value}"
    else:
        return f"ERR[{r.code}]: {r.error}"


def chain_results(results: List[Result[int]]) -> Result[List[int]]:
    values: List[int] = []
    for r in results:
        if isinstance(r, Failure):
            return r
        values.append(r.value)
    return Success(values)


# --- Protocol unions ---

@runtime_checkable
class Printable(Protocol):
    def __str__(self) -> str: ...

@runtime_checkable
class Measurable(Protocol):
    def __len__(self) -> int: ...

@runtime_checkable
class Numeric(Protocol):
    def __add__(self, other: Any) -> Any: ...
    def __mul__(self, other: Any) -> Any: ...


def describe_value(val: Union[Printable, Measurable, Numeric]) -> str:
    parts: List[str] = []
    if isinstance(val, Printable):
        parts.append(f"str={val}")
    if isinstance(val, Measurable):
        parts.append(f"len={len(val)}")
    return ", ".join(parts) if parts else "unknown"


# --- TypedDict unions ---

from typing import TypedDict


class UserInfo(TypedDict):
    name: str
    age: int
    email: str


class CompanyInfo(TypedDict):
    name: str
    employees: int
    industry: str


class ProductInfo(TypedDict):
    name: str
    price: float
    category: str


Entity = Union[UserInfo, CompanyInfo, ProductInfo]


def entity_name(entity: Entity) -> str:
    return entity["name"]


def entity_summary(entity: Entity) -> str:
    if "age" in entity:
        e: UserInfo = entity  # type: ignore
        return f"User: {e['name']}, age {e['age']}"
    elif "employees" in entity:
        e2: CompanyInfo = entity  # type: ignore
        return f"Company: {e2['name']}, {e2['employees']} employees"
    else:
        e3: ProductInfo = entity  # type: ignore
        return f"Product: {e3['name']}, ${e3['price']}"


# --- Deep union chains ---

Level0 = Union[int, str]
Level1 = Union[Level0, float, bool]
Level2 = Union[Level1, bytes, list]
Level3 = Union[Level2, dict, tuple]
Level4 = Union[Level3, set, frozenset]
Level5 = Union[Level4, complex, memoryview]

DeepUnion = Level5


def process_deep(val: DeepUnion) -> str:
    if isinstance(val, int):
        return "int"
    elif isinstance(val, str):
        return "str"
    elif isinstance(val, float):
        return "float"
    elif isinstance(val, bool):
        return "bool"
    elif isinstance(val, bytes):
        return "bytes"
    elif isinstance(val, list):
        return "list"
    elif isinstance(val, dict):
        return "dict"
    elif isinstance(val, tuple):
        return "tuple"
    elif isinstance(val, set):
        return "set"
    elif isinstance(val, frozenset):
        return "frozenset"
    elif isinstance(val, complex):
        return "complex"
    elif isinstance(val, memoryview):
        return "memoryview"
    else:
        return "unknown"


# --- Union of many dataclasses ---

@dataclass
class EventA:
    kind: Literal["a"] = "a"
    payload: str = ""

@dataclass
class EventB:
    kind: Literal["b"] = "b"
    count: int = 0

@dataclass
class EventC:
    kind: Literal["c"] = "c"
    flag: bool = False

@dataclass
class EventD:
    kind: Literal["d"] = "d"
    value: float = 0.0

@dataclass
class EventE:
    kind: Literal["e"] = "e"
    items: List[str] = None  # type: ignore

@dataclass
class EventF:
    kind: Literal["f"] = "f"
    data: Dict[str, Any] = None  # type: ignore

@dataclass
class EventG:
    kind: Literal["g"] = "g"
    source: str = ""

@dataclass
class EventH:
    kind: Literal["h"] = "h"
    target: str = ""

@dataclass
class EventI:
    kind: Literal["i"] = "i"
    timestamp: float = 0.0

@dataclass
class EventJ:
    kind: Literal["j"] = "j"
    priority: int = 0

Event = Union[EventA, EventB, EventC, EventD, EventE, EventF, EventG, EventH, EventI, EventJ]


def dispatch_event(event: Event) -> str:
    if event.kind == "a":
        return f"A: {event.payload}"
    elif event.kind == "b":
        return f"B: {event.count}"
    elif event.kind == "c":
        return f"C: {event.flag}"
    elif event.kind == "d":
        return f"D: {event.value}"
    elif event.kind == "e":
        return f"E: {event.items}"
    elif event.kind == "f":
        return f"F: {event.data}"
    elif event.kind == "g":
        return f"G: {event.source}"
    elif event.kind == "h":
        return f"H: {event.target}"
    elif event.kind == "i":
        return f"I: {event.timestamp}"
    elif event.kind == "j":
        return f"J: {event.priority}"
    else:
        _: Never = event
        raise ValueError


# --- Conditional types via overload ---

@overload
def maybe_parse(raw: str, strict: Literal[True]) -> int: ...
@overload
def maybe_parse(raw: str, strict: Literal[False]) -> Optional[int]: ...
@overload
def maybe_parse(raw: str, strict: bool = ...) -> Optional[int]: ...

def maybe_parse(raw: str, strict: bool = False) -> Optional[int]:
    try:
        return int(raw)
    except ValueError:
        if strict:
            raise
        return None


# End of union_heavy.py
