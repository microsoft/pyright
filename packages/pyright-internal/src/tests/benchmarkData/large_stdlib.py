# large_stdlib.py — simulates a large stdlib-like module (~3000+ lines)
# Used for tokenizer/parser/type-evaluator benchmarking.

from __future__ import annotations

import os
import sys
import typing
from typing import (
    Any,
    ClassVar,
    Dict,
    Final,
    Generic,
    Iterator,
    List,
    Literal,
    Optional,
    Protocol,
    Sequence,
    Set,
    Tuple,
    TypeVar,
    Union,
    overload,
    runtime_checkable,
)

_T = TypeVar("_T")
_T_co = TypeVar("_T_co", covariant=True)
_KT = TypeVar("_KT")
_VT = TypeVar("_VT")
_S = TypeVar("_S", bound="Sortable")


class Sortable(Protocol):
    def __lt__(self, other: Any) -> bool: ...
    def __le__(self, other: Any) -> bool: ...


# --- Large class hierarchy ---


class BaseNode:
    """Base class for all AST nodes."""

    kind: ClassVar[str] = "base"
    _parent: Optional[BaseNode] = None
    _children: List[BaseNode]
    _line: int
    _col: int
    _end_line: int
    _end_col: int

    def __init__(
        self,
        line: int = 0,
        col: int = 0,
        end_line: int = 0,
        end_col: int = 0,
    ) -> None:
        self._children = []
        self._line = line
        self._col = col
        self._end_line = end_line
        self._end_col = end_col

    @property
    def parent(self) -> Optional[BaseNode]:
        return self._parent

    @parent.setter
    def parent(self, value: Optional[BaseNode]) -> None:
        self._parent = value

    def add_child(self, child: BaseNode) -> None:
        child._parent = self
        self._children.append(child)

    def remove_child(self, child: BaseNode) -> None:
        self._children.remove(child)
        child._parent = None

    def walk(self) -> Iterator[BaseNode]:
        yield self
        for child in self._children:
            yield from child.walk()

    def find_parent(self, kind: str) -> Optional[BaseNode]:
        node = self._parent
        while node is not None:
            if node.kind == kind:
                return node
            node = node._parent
        return None

    def depth(self) -> int:
        d = 0
        node = self._parent
        while node is not None:
            d += 1
            node = node._parent
        return d

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(line={self._line}, col={self._col})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, BaseNode):
            return NotImplemented
        return (
            self.kind == other.kind
            and self._line == other._line
            and self._col == other._col
        )

    def __hash__(self) -> int:
        return hash((self.kind, self._line, self._col))


class Expression(BaseNode):
    kind: ClassVar[str] = "expression"

    def evaluate(self) -> Any:
        raise NotImplementedError


class Statement(BaseNode):
    kind: ClassVar[str] = "statement"

    def execute(self) -> None:
        raise NotImplementedError


class Module(BaseNode):
    kind: ClassVar[str] = "module"
    name: str
    docstring: Optional[str]
    imports: List[ImportStatement]
    body: List[Statement]

    def __init__(self, name: str, docstring: Optional[str] = None) -> None:
        super().__init__()
        self.name = name
        self.docstring = docstring
        self.imports = []
        self.body = []


class ImportStatement(Statement):
    kind: ClassVar[str] = "import"
    module_name: str
    alias: Optional[str]
    names: List[Tuple[str, Optional[str]]]

    def __init__(
        self,
        module_name: str,
        alias: Optional[str] = None,
        names: Optional[List[Tuple[str, Optional[str]]]] = None,
    ) -> None:
        super().__init__()
        self.module_name = module_name
        self.alias = alias
        self.names = names or []

    def execute(self) -> None:
        pass


class FunctionDef(Statement):
    kind: ClassVar[str] = "funcdef"
    name: str
    args: List[Argument]
    return_type: Optional[Expression]
    body: List[Statement]
    decorators: List[Expression]
    is_async: bool

    def __init__(
        self,
        name: str,
        args: Optional[List[Argument]] = None,
        return_type: Optional[Expression] = None,
        is_async: bool = False,
    ) -> None:
        super().__init__()
        self.name = name
        self.args = args or []
        self.return_type = return_type
        self.body = []
        self.decorators = []
        self.is_async = is_async

    def execute(self) -> None:
        pass


class ClassDef(Statement):
    kind: ClassVar[str] = "classdef"
    name: str
    bases: List[Expression]
    body: List[Statement]
    decorators: List[Expression]
    metaclass: Optional[Expression]

    def __init__(
        self,
        name: str,
        bases: Optional[List[Expression]] = None,
        metaclass: Optional[Expression] = None,
    ) -> None:
        super().__init__()
        self.name = name
        self.bases = bases or []
        self.body = []
        self.decorators = []
        self.metaclass = metaclass

    def execute(self) -> None:
        pass


class Argument:
    name: str
    annotation: Optional[Expression]
    default: Optional[Expression]
    kind: str  # "positional", "keyword", "*args", "**kwargs"

    def __init__(
        self,
        name: str,
        annotation: Optional[Expression] = None,
        default: Optional[Expression] = None,
        kind: str = "positional",
    ) -> None:
        self.name = name
        self.annotation = annotation
        self.default = default
        self.kind = kind


class AssignStatement(Statement):
    kind: ClassVar[str] = "assign"
    targets: List[Expression]
    value: Expression
    type_comment: Optional[str]

    def __init__(
        self,
        targets: List[Expression],
        value: Expression,
        type_comment: Optional[str] = None,
    ) -> None:
        super().__init__()
        self.targets = targets
        self.value = value
        self.type_comment = type_comment

    def execute(self) -> None:
        pass


class ReturnStatement(Statement):
    kind: ClassVar[str] = "return"
    value: Optional[Expression]

    def __init__(self, value: Optional[Expression] = None) -> None:
        super().__init__()
        self.value = value

    def execute(self) -> None:
        pass


class IfStatement(Statement):
    kind: ClassVar[str] = "if"
    condition: Expression
    body: List[Statement]
    elif_clauses: List[Tuple[Expression, List[Statement]]]
    else_body: Optional[List[Statement]]

    def __init__(self, condition: Expression) -> None:
        super().__init__()
        self.condition = condition
        self.body = []
        self.elif_clauses = []
        self.else_body = None

    def execute(self) -> None:
        pass


class ForStatement(Statement):
    kind: ClassVar[str] = "for"
    target: Expression
    iterable: Expression
    body: List[Statement]
    else_body: Optional[List[Statement]]
    is_async: bool

    def __init__(
        self,
        target: Expression,
        iterable: Expression,
        is_async: bool = False,
    ) -> None:
        super().__init__()
        self.target = target
        self.iterable = iterable
        self.body = []
        self.else_body = None
        self.is_async = is_async

    def execute(self) -> None:
        pass


class WhileStatement(Statement):
    kind: ClassVar[str] = "while"
    condition: Expression
    body: List[Statement]
    else_body: Optional[List[Statement]]

    def __init__(self, condition: Expression) -> None:
        super().__init__()
        self.condition = condition
        self.body = []
        self.else_body = None

    def execute(self) -> None:
        pass


class TryStatement(Statement):
    kind: ClassVar[str] = "try"
    body: List[Statement]
    handlers: List[ExceptHandler]
    else_body: Optional[List[Statement]]
    finally_body: Optional[List[Statement]]

    def __init__(self) -> None:
        super().__init__()
        self.body = []
        self.handlers = []
        self.else_body = None
        self.finally_body = None

    def execute(self) -> None:
        pass


class ExceptHandler(BaseNode):
    kind: ClassVar[str] = "except_handler"
    exception_type: Optional[Expression]
    name: Optional[str]
    body: List[Statement]

    def __init__(
        self,
        exception_type: Optional[Expression] = None,
        name: Optional[str] = None,
    ) -> None:
        super().__init__()
        self.exception_type = exception_type
        self.name = name
        self.body = []


class WithStatement(Statement):
    kind: ClassVar[str] = "with"
    items: List[Tuple[Expression, Optional[Expression]]]
    body: List[Statement]
    is_async: bool

    def __init__(self, is_async: bool = False) -> None:
        super().__init__()
        self.items = []
        self.body = []
        self.is_async = is_async

    def execute(self) -> None:
        pass


class RaiseStatement(Statement):
    kind: ClassVar[str] = "raise"
    exception: Optional[Expression]
    cause: Optional[Expression]

    def __init__(
        self,
        exception: Optional[Expression] = None,
        cause: Optional[Expression] = None,
    ) -> None:
        super().__init__()
        self.exception = exception
        self.cause = cause

    def execute(self) -> None:
        pass


class AssertStatement(Statement):
    kind: ClassVar[str] = "assert"
    test: Expression
    msg: Optional[Expression]

    def __init__(
        self,
        test: Expression,
        msg: Optional[Expression] = None,
    ) -> None:
        super().__init__()
        self.test = test
        self.msg = msg

    def execute(self) -> None:
        pass


# --- Expressions ---


class NameExpr(Expression):
    kind: ClassVar[str] = "name"
    id: str

    def __init__(self, id: str) -> None:
        super().__init__()
        self.id = id

    def evaluate(self) -> str:
        return self.id


class NumberLiteral(Expression):
    kind: ClassVar[str] = "number"
    value: Union[int, float, complex]

    def __init__(self, value: Union[int, float, complex]) -> None:
        super().__init__()
        self.value = value

    def evaluate(self) -> Union[int, float, complex]:
        return self.value


class StringLiteral(Expression):
    kind: ClassVar[str] = "string"
    value: str
    is_fstring: bool
    is_bytes: bool
    is_raw: bool

    def __init__(
        self,
        value: str,
        is_fstring: bool = False,
        is_bytes: bool = False,
        is_raw: bool = False,
    ) -> None:
        super().__init__()
        self.value = value
        self.is_fstring = is_fstring
        self.is_bytes = is_bytes
        self.is_raw = is_raw

    def evaluate(self) -> str:
        return self.value


class BoolLiteral(Expression):
    kind: ClassVar[str] = "bool"
    value: bool

    def __init__(self, value: bool) -> None:
        super().__init__()
        self.value = value

    def evaluate(self) -> bool:
        return self.value


class NoneLiteral(Expression):
    kind: ClassVar[str] = "none"

    def evaluate(self) -> None:
        return None


class EllipsisLiteral(Expression):
    kind: ClassVar[str] = "ellipsis"

    def evaluate(self) -> Any:
        return ...


class BinaryOp(Expression):
    kind: ClassVar[str] = "binop"
    left: Expression
    op: str
    right: Expression

    def __init__(self, left: Expression, op: str, right: Expression) -> None:
        super().__init__()
        self.left = left
        self.op = op
        self.right = right

    def evaluate(self) -> Any:
        raise NotImplementedError


class UnaryOp(Expression):
    kind: ClassVar[str] = "unaryop"
    op: str
    operand: Expression

    def __init__(self, op: str, operand: Expression) -> None:
        super().__init__()
        self.op = op
        self.operand = operand

    def evaluate(self) -> Any:
        raise NotImplementedError


class CompareExpr(Expression):
    kind: ClassVar[str] = "compare"
    left: Expression
    comparators: List[Tuple[str, Expression]]

    def __init__(self, left: Expression) -> None:
        super().__init__()
        self.left = left
        self.comparators = []

    def evaluate(self) -> bool:
        raise NotImplementedError


class CallExpr(Expression):
    kind: ClassVar[str] = "call"
    func: Expression
    args: List[Expression]
    kwargs: Dict[str, Expression]
    starargs: List[Expression]
    starkwargs: List[Expression]

    def __init__(self, func: Expression) -> None:
        super().__init__()
        self.func = func
        self.args = []
        self.kwargs = {}
        self.starargs = []
        self.starkwargs = []

    def evaluate(self) -> Any:
        raise NotImplementedError


class AttributeExpr(Expression):
    kind: ClassVar[str] = "attribute"
    value: Expression
    attr: str

    def __init__(self, value: Expression, attr: str) -> None:
        super().__init__()
        self.value = value
        self.attr = attr

    def evaluate(self) -> Any:
        raise NotImplementedError


class SubscriptExpr(Expression):
    kind: ClassVar[str] = "subscript"
    value: Expression
    index: Expression

    def __init__(self, value: Expression, index: Expression) -> None:
        super().__init__()
        self.value = value
        self.index = index

    def evaluate(self) -> Any:
        raise NotImplementedError


class ListExpr(Expression):
    kind: ClassVar[str] = "list"
    elements: List[Expression]

    def __init__(self, elements: Optional[List[Expression]] = None) -> None:
        super().__init__()
        self.elements = elements or []

    def evaluate(self) -> list:
        raise NotImplementedError


class DictExpr(Expression):
    kind: ClassVar[str] = "dict"
    keys: List[Optional[Expression]]
    values: List[Expression]

    def __init__(self) -> None:
        super().__init__()
        self.keys = []
        self.values = []

    def evaluate(self) -> dict:
        raise NotImplementedError


class SetExpr(Expression):
    kind: ClassVar[str] = "set"
    elements: List[Expression]

    def __init__(self, elements: Optional[List[Expression]] = None) -> None:
        super().__init__()
        self.elements = elements or []

    def evaluate(self) -> set:
        raise NotImplementedError


class TupleExpr(Expression):
    kind: ClassVar[str] = "tuple"
    elements: List[Expression]

    def __init__(self, elements: Optional[List[Expression]] = None) -> None:
        super().__init__()
        self.elements = elements or []

    def evaluate(self) -> tuple:
        raise NotImplementedError


class LambdaExpr(Expression):
    kind: ClassVar[str] = "lambda"
    args: List[Argument]
    body: Expression

    def __init__(self, body: Expression) -> None:
        super().__init__()
        self.args = []
        self.body = body

    def evaluate(self) -> Any:
        raise NotImplementedError


class ListCompExpr(Expression):
    kind: ClassVar[str] = "listcomp"
    element: Expression
    generators: List[Tuple[Expression, Expression, List[Expression]]]

    def __init__(self, element: Expression) -> None:
        super().__init__()
        self.element = element
        self.generators = []

    def evaluate(self) -> list:
        raise NotImplementedError


class DictCompExpr(Expression):
    kind: ClassVar[str] = "dictcomp"
    key: Expression
    value: Expression
    generators: List[Tuple[Expression, Expression, List[Expression]]]

    def __init__(self, key: Expression, value: Expression) -> None:
        super().__init__()
        self.key = key
        self.value = value
        self.generators = []

    def evaluate(self) -> dict:
        raise NotImplementedError


class SetCompExpr(Expression):
    kind: ClassVar[str] = "setcomp"
    element: Expression
    generators: List[Tuple[Expression, Expression, List[Expression]]]

    def __init__(self, element: Expression) -> None:
        super().__init__()
        self.element = element
        self.generators = []

    def evaluate(self) -> set:
        raise NotImplementedError


class GeneratorExpr(Expression):
    kind: ClassVar[str] = "genexpr"
    element: Expression
    generators: List[Tuple[Expression, Expression, List[Expression]]]

    def __init__(self, element: Expression) -> None:
        super().__init__()
        self.element = element
        self.generators = []

    def evaluate(self) -> Any:
        raise NotImplementedError


class ConditionalExpr(Expression):
    kind: ClassVar[str] = "conditional"
    body: Expression
    test: Expression
    orelse: Expression

    def __init__(
        self,
        body: Expression,
        test: Expression,
        orelse: Expression,
    ) -> None:
        super().__init__()
        self.body = body
        self.test = test
        self.orelse = orelse

    def evaluate(self) -> Any:
        raise NotImplementedError


class SliceExpr(Expression):
    kind: ClassVar[str] = "slice"
    lower: Optional[Expression]
    upper: Optional[Expression]
    step: Optional[Expression]

    def __init__(
        self,
        lower: Optional[Expression] = None,
        upper: Optional[Expression] = None,
        step: Optional[Expression] = None,
    ) -> None:
        super().__init__()
        self.lower = lower
        self.upper = upper
        self.step = step

    def evaluate(self) -> slice:
        raise NotImplementedError


class StarredExpr(Expression):
    kind: ClassVar[str] = "starred"
    value: Expression

    def __init__(self, value: Expression) -> None:
        super().__init__()
        self.value = value

    def evaluate(self) -> Any:
        raise NotImplementedError


class WalrusExpr(Expression):
    kind: ClassVar[str] = "walrus"
    target: NameExpr
    value: Expression

    def __init__(self, target: NameExpr, value: Expression) -> None:
        super().__init__()
        self.target = target
        self.value = value

    def evaluate(self) -> Any:
        raise NotImplementedError


class MatchStatement(Statement):
    kind: ClassVar[str] = "match"
    subject: Expression
    cases: List[MatchCase]

    def __init__(self, subject: Expression) -> None:
        super().__init__()
        self.subject = subject
        self.cases = []

    def execute(self) -> None:
        pass


class MatchCase(BaseNode):
    kind: ClassVar[str] = "match_case"
    pattern: Expression
    guard: Optional[Expression]
    body: List[Statement]

    def __init__(
        self,
        pattern: Expression,
        guard: Optional[Expression] = None,
    ) -> None:
        super().__init__()
        self.pattern = pattern
        self.guard = guard
        self.body = []


# --- Generic containers ---


class Container(Generic[_T]):
    """A generic container with multiple operations."""

    _items: List[_T]
    _capacity: int
    _name: str

    def __init__(self, name: str, capacity: int = 100) -> None:
        self._items = []
        self._capacity = capacity
        self._name = name

    def add(self, item: _T) -> bool:
        if len(self._items) >= self._capacity:
            return False
        self._items.append(item)
        return True

    def remove(self, item: _T) -> bool:
        try:
            self._items.remove(item)
            return True
        except ValueError:
            return False

    def get(self, index: int) -> _T:
        return self._items[index]

    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self) -> Iterator[_T]:
        return iter(self._items)

    def __contains__(self, item: _T) -> bool:
        return item in self._items

    def clear(self) -> None:
        self._items.clear()

    def sort(self: Container[_S]) -> None:
        self._items.sort()

    @property
    def capacity(self) -> int:
        return self._capacity

    @property
    def is_full(self) -> bool:
        return len(self._items) >= self._capacity

    @property
    def is_empty(self) -> bool:
        return len(self._items) == 0


class OrderedContainer(Container[_T]):
    """Container that maintains insertion order with index access."""

    _index_map: Dict[int, _T]

    def __init__(self, name: str, capacity: int = 100) -> None:
        super().__init__(name, capacity)
        self._index_map = {}

    def add(self, item: _T) -> bool:
        result = super().add(item)
        if result:
            self._index_map[len(self._items) - 1] = item
        return result

    def get_by_index(self, index: int) -> Optional[_T]:
        return self._index_map.get(index)


class MappedContainer(Generic[_KT, _VT]):
    """A dictionary-like container."""

    _store: Dict[_KT, _VT]
    _max_size: int

    def __init__(self, max_size: int = 1000) -> None:
        self._store = {}
        self._max_size = max_size

    def put(self, key: _KT, value: _VT) -> bool:
        if len(self._store) >= self._max_size and key not in self._store:
            return False
        self._store[key] = value
        return True

    def get(self, key: _KT, default: Optional[_VT] = None) -> Optional[_VT]:
        return self._store.get(key, default)

    def remove(self, key: _KT) -> Optional[_VT]:
        return self._store.pop(key, None)

    def keys(self) -> Set[_KT]:
        return set(self._store.keys())

    def values(self) -> List[_VT]:
        return list(self._store.values())

    def items(self) -> List[Tuple[_KT, _VT]]:
        return list(self._store.items())

    def __len__(self) -> int:
        return len(self._store)

    def __contains__(self, key: _KT) -> bool:
        return key in self._store


# --- Overloaded functions ---


@overload
def process(value: int) -> str: ...
@overload
def process(value: str) -> int: ...
@overload
def process(value: bytes) -> List[int]: ...
@overload
def process(value: List[int]) -> bytes: ...
@overload
def process(value: Dict[str, Any]) -> List[Tuple[str, Any]]: ...


def process(
    value: Union[int, str, bytes, List[int], Dict[str, Any]],
) -> Union[str, int, List[int], bytes, List[Tuple[str, Any]]]:
    if isinstance(value, int):
        return str(value)
    elif isinstance(value, str):
        return len(value)
    elif isinstance(value, bytes):
        return list(value)
    elif isinstance(value, list):
        return bytes(value)
    else:
        return list(value.items())


@overload
def convert(src: str, target: type[int]) -> int: ...
@overload
def convert(src: str, target: type[float]) -> float: ...
@overload
def convert(src: str, target: type[bool]) -> bool: ...
@overload
def convert(src: str, target: type[bytes]) -> bytes: ...


def convert(
    src: str,
    target: Union[type[int], type[float], type[bool], type[bytes]],
) -> Union[int, float, bool, bytes]:
    return target(src)  # type: ignore


# --- Protocol examples ---


@runtime_checkable
class Serializable(Protocol):
    def serialize(self) -> bytes: ...
    def deserialize(self, data: bytes) -> None: ...


@runtime_checkable
class Comparable(Protocol[_T_co]):
    def compare_to(self, other: _T_co) -> int: ...


class Hashable(Protocol):
    def __hash__(self) -> int: ...
    def __eq__(self, other: object) -> bool: ...


class Sizeable(Protocol):
    def __len__(self) -> int: ...
    def __sizeof__(self) -> int: ...


class Printable(Protocol):
    def __str__(self) -> str: ...
    def __repr__(self) -> str: ...


# --- Complex type annotations ---


ConfigValue = Union[str, int, float, bool, None, List["ConfigValue"], Dict[str, "ConfigValue"]]

NestedDict = Dict[str, Union[str, int, Dict[str, Union[str, int, Dict[str, Any]]]]]

CallbackType = typing.Callable[[str, int, Optional[Dict[str, Any]]], bool]

EventHandler = typing.Callable[..., Optional[bool]]

TreeNode = Union[
    "LeafNode",
    "BranchNode",
    Tuple["TreeNode", "TreeNode"],
]


class LeafNode:
    value: Any

    def __init__(self, value: Any) -> None:
        self.value = value


class BranchNode:
    children: List[TreeNode]
    label: str

    def __init__(self, label: str) -> None:
        self.children = []
        self.label = label


# --- Large function set (simulating stdlib coverage) ---


def compute_checksum(data: bytes, algorithm: str = "crc32") -> int:
    """Compute a checksum of the given data."""
    if algorithm == "crc32":
        result = 0
        for byte in data:
            result = (result >> 8) ^ byte
        return result & 0xFFFFFFFF
    elif algorithm == "simple":
        return sum(data) & 0xFFFFFFFF
    else:
        raise ValueError(f"Unknown algorithm: {algorithm}")


def format_bytes(size: int) -> str:
    """Format a byte count as a human-readable string."""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if abs(size) < 1024.0:
            return f"{size:.1f} {unit}"
        size = int(size / 1024)
    return f"{size:.1f} PB"


def parse_version(version_str: str) -> Tuple[int, int, int]:
    """Parse a version string like '1.2.3' into a tuple."""
    parts = version_str.split(".")
    if len(parts) != 3:
        raise ValueError(f"Invalid version: {version_str}")
    return (int(parts[0]), int(parts[1]), int(parts[2]))


def merge_dicts(
    *dicts: Dict[str, Any],
    deep: bool = False,
) -> Dict[str, Any]:
    """Merge multiple dictionaries."""
    result: Dict[str, Any] = {}
    for d in dicts:
        if deep:
            for key, value in d.items():
                if (
                    key in result
                    and isinstance(result[key], dict)
                    and isinstance(value, dict)
                ):
                    result[key] = merge_dicts(result[key], value, deep=True)
                else:
                    result[key] = value
        else:
            result.update(d)
    return result


def flatten_list(nested: List[Any], max_depth: int = -1) -> List[Any]:
    """Flatten a nested list up to max_depth levels."""
    result: List[Any] = []
    for item in nested:
        if isinstance(item, list) and max_depth != 0:
            result.extend(flatten_list(item, max_depth - 1))
        else:
            result.append(item)
    return result


def chunk_list(lst: List[_T], size: int) -> List[List[_T]]:
    """Split a list into chunks of the given size."""
    return [lst[i : i + size] for i in range(0, len(lst), size)]


def deduplicate(items: Sequence[_T]) -> List[_T]:
    """Remove duplicates while preserving order."""
    seen: Set[Any] = set()
    result: List[_T] = []
    for item in items:
        key = id(item) if not isinstance(item, (str, int, float, bool, bytes)) else item
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result


def retry(
    func: typing.Callable[[], _T],
    max_attempts: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    exceptions: Tuple[type, ...] = (Exception,),
) -> _T:
    """Retry a function with exponential backoff."""
    last_exception: Optional[Exception] = None
    current_delay = delay
    for attempt in range(max_attempts):
        try:
            return func()
        except exceptions as e:
            last_exception = e
            if attempt < max_attempts - 1:
                current_delay *= backoff
    raise last_exception  # type: ignore


def memoize(func: typing.Callable[..., _T]) -> typing.Callable[..., _T]:
    """Simple memoization decorator."""
    cache: Dict[str, _T] = {}

    def wrapper(*args: Any, **kwargs: Any) -> _T:
        key = str((args, sorted(kwargs.items())))
        if key not in cache:
            cache[key] = func(*args, **kwargs)
        return cache[key]

    return wrapper


# --- More node types to add bulk ---


class YieldExpr(Expression):
    kind: ClassVar[str] = "yield"
    value: Optional[Expression]

    def __init__(self, value: Optional[Expression] = None) -> None:
        super().__init__()
        self.value = value

    def evaluate(self) -> Any:
        raise NotImplementedError


class YieldFromExpr(Expression):
    kind: ClassVar[str] = "yield_from"
    value: Expression

    def __init__(self, value: Expression) -> None:
        super().__init__()
        self.value = value

    def evaluate(self) -> Any:
        raise NotImplementedError


class AwaitExpr(Expression):
    kind: ClassVar[str] = "await"
    value: Expression

    def __init__(self, value: Expression) -> None:
        super().__init__()
        self.value = value

    def evaluate(self) -> Any:
        raise NotImplementedError


class FormattedValue(Expression):
    kind: ClassVar[str] = "formatted_value"
    value: Expression
    conversion: Optional[str]
    format_spec: Optional[Expression]

    def __init__(
        self,
        value: Expression,
        conversion: Optional[str] = None,
        format_spec: Optional[Expression] = None,
    ) -> None:
        super().__init__()
        self.value = value
        self.conversion = conversion
        self.format_spec = format_spec

    def evaluate(self) -> str:
        raise NotImplementedError


class JoinedStr(Expression):
    """Represents an f-string."""

    kind: ClassVar[str] = "fstring"
    values: List[Expression]

    def __init__(self, values: Optional[List[Expression]] = None) -> None:
        super().__init__()
        self.values = values or []

    def evaluate(self) -> str:
        raise NotImplementedError


class TypeAlias(Statement):
    kind: ClassVar[str] = "type_alias"
    name: str
    type_params: List[Expression]
    value: Expression

    def __init__(
        self,
        name: str,
        value: Expression,
        type_params: Optional[List[Expression]] = None,
    ) -> None:
        super().__init__()
        self.name = name
        self.value = value
        self.type_params = type_params or []

    def execute(self) -> None:
        pass


class GlobalStatement(Statement):
    kind: ClassVar[str] = "global"
    names: List[str]

    def __init__(self, names: List[str]) -> None:
        super().__init__()
        self.names = names

    def execute(self) -> None:
        pass


class NonlocalStatement(Statement):
    kind: ClassVar[str] = "nonlocal"
    names: List[str]

    def __init__(self, names: List[str]) -> None:
        super().__init__()
        self.names = names

    def execute(self) -> None:
        pass


class DeleteStatement(Statement):
    kind: ClassVar[str] = "del"
    targets: List[Expression]

    def __init__(self, targets: List[Expression]) -> None:
        super().__init__()
        self.targets = targets

    def execute(self) -> None:
        pass


class PassStatement(Statement):
    kind: ClassVar[str] = "pass"

    def execute(self) -> None:
        pass


class BreakStatement(Statement):
    kind: ClassVar[str] = "break"

    def execute(self) -> None:
        pass


class ContinueStatement(Statement):
    kind: ClassVar[str] = "continue"

    def execute(self) -> None:
        pass


# --- Visitor pattern ---


class NodeVisitor(Generic[_T]):
    """AST node visitor with generic return type."""

    def visit(self, node: BaseNode) -> _T:
        method_name = f"visit_{node.kind}"
        visitor = getattr(self, method_name, self.generic_visit)
        return visitor(node)

    def generic_visit(self, node: BaseNode) -> _T:
        raise NotImplementedError(f"No visitor for {node.kind}")

    def visit_module(self, node: Module) -> _T:
        return self.generic_visit(node)

    def visit_funcdef(self, node: FunctionDef) -> _T:
        return self.generic_visit(node)

    def visit_classdef(self, node: ClassDef) -> _T:
        return self.generic_visit(node)

    def visit_import(self, node: ImportStatement) -> _T:
        return self.generic_visit(node)

    def visit_assign(self, node: AssignStatement) -> _T:
        return self.generic_visit(node)

    def visit_return(self, node: ReturnStatement) -> _T:
        return self.generic_visit(node)

    def visit_if(self, node: IfStatement) -> _T:
        return self.generic_visit(node)

    def visit_for(self, node: ForStatement) -> _T:
        return self.generic_visit(node)

    def visit_while(self, node: WhileStatement) -> _T:
        return self.generic_visit(node)

    def visit_try(self, node: TryStatement) -> _T:
        return self.generic_visit(node)

    def visit_with(self, node: WithStatement) -> _T:
        return self.generic_visit(node)

    def visit_raise(self, node: RaiseStatement) -> _T:
        return self.generic_visit(node)

    def visit_assert(self, node: AssertStatement) -> _T:
        return self.generic_visit(node)

    def visit_expression(self, node: Expression) -> _T:
        return self.generic_visit(node)

    def visit_name(self, node: NameExpr) -> _T:
        return self.visit_expression(node)

    def visit_number(self, node: NumberLiteral) -> _T:
        return self.visit_expression(node)

    def visit_string(self, node: StringLiteral) -> _T:
        return self.visit_expression(node)

    def visit_bool(self, node: BoolLiteral) -> _T:
        return self.visit_expression(node)

    def visit_none(self, node: NoneLiteral) -> _T:
        return self.visit_expression(node)

    def visit_ellipsis(self, node: EllipsisLiteral) -> _T:
        return self.visit_expression(node)

    def visit_binop(self, node: BinaryOp) -> _T:
        return self.visit_expression(node)

    def visit_unaryop(self, node: UnaryOp) -> _T:
        return self.visit_expression(node)

    def visit_compare(self, node: CompareExpr) -> _T:
        return self.visit_expression(node)

    def visit_call(self, node: CallExpr) -> _T:
        return self.visit_expression(node)

    def visit_attribute(self, node: AttributeExpr) -> _T:
        return self.visit_expression(node)

    def visit_subscript(self, node: SubscriptExpr) -> _T:
        return self.visit_expression(node)

    def visit_list(self, node: ListExpr) -> _T:
        return self.visit_expression(node)

    def visit_dict(self, node: DictExpr) -> _T:
        return self.visit_expression(node)

    def visit_set(self, node: SetExpr) -> _T:
        return self.visit_expression(node)

    def visit_tuple(self, node: TupleExpr) -> _T:
        return self.visit_expression(node)

    def visit_lambda(self, node: LambdaExpr) -> _T:
        return self.visit_expression(node)

    def visit_listcomp(self, node: ListCompExpr) -> _T:
        return self.visit_expression(node)

    def visit_dictcomp(self, node: DictCompExpr) -> _T:
        return self.visit_expression(node)

    def visit_setcomp(self, node: SetCompExpr) -> _T:
        return self.visit_expression(node)

    def visit_genexpr(self, node: GeneratorExpr) -> _T:
        return self.visit_expression(node)

    def visit_conditional(self, node: ConditionalExpr) -> _T:
        return self.visit_expression(node)

    def visit_slice(self, node: SliceExpr) -> _T:
        return self.visit_expression(node)

    def visit_starred(self, node: StarredExpr) -> _T:
        return self.visit_expression(node)

    def visit_walrus(self, node: WalrusExpr) -> _T:
        return self.visit_expression(node)

    def visit_match(self, node: MatchStatement) -> _T:
        return self.generic_visit(node)

    def visit_yield(self, node: YieldExpr) -> _T:
        return self.visit_expression(node)

    def visit_yield_from(self, node: YieldFromExpr) -> _T:
        return self.visit_expression(node)

    def visit_await(self, node: AwaitExpr) -> _T:
        return self.visit_expression(node)

    def visit_fstring(self, node: JoinedStr) -> _T:
        return self.visit_expression(node)


# --- Transformer subclass ---


class NodeTransformer(NodeVisitor[BaseNode]):
    """Visitor that returns transformed nodes."""

    def generic_visit(self, node: BaseNode) -> BaseNode:
        return node


# --- Registry pattern ---


class NodeRegistry:
    """Registry of node factories."""

    _factories: Dict[str, typing.Callable[..., BaseNode]]

    def __init__(self) -> None:
        self._factories = {}

    def register(
        self, kind: str
    ) -> typing.Callable[
        [typing.Callable[..., BaseNode]], typing.Callable[..., BaseNode]
    ]:
        def decorator(
            factory: typing.Callable[..., BaseNode],
        ) -> typing.Callable[..., BaseNode]:
            self._factories[kind] = factory
            return factory

        return decorator

    def create(self, kind: str, **kwargs: Any) -> BaseNode:
        factory = self._factories.get(kind)
        if factory is None:
            raise KeyError(f"No factory registered for kind: {kind}")
        return factory(**kwargs)

    def kinds(self) -> List[str]:
        return list(self._factories.keys())


# --- Utility constants ---

MAX_RECURSION_DEPTH: Final[int] = 256
DEFAULT_INDENT: Final[str] = "    "
BUILTIN_TYPES: Final[Tuple[str, ...]] = (
    "int",
    "float",
    "complex",
    "bool",
    "str",
    "bytes",
    "bytearray",
    "memoryview",
    "list",
    "tuple",
    "dict",
    "set",
    "frozenset",
    "range",
    "slice",
    "type",
    "object",
    "None",
)

COMPARISON_OPS: Final[Tuple[str, ...]] = (
    "==",
    "!=",
    "<",
    "<=",
    ">",
    ">=",
    "is",
    "is not",
    "in",
    "not in",
)

BOOLEAN_OPS: Final[Tuple[str, ...]] = ("and", "or")

UNARY_OPS: Final[Tuple[str, ...]] = ("+", "-", "~", "not")

BINARY_OPS: Final[Tuple[str, ...]] = (
    "+",
    "-",
    "*",
    "/",
    "//",
    "%",
    "**",
    "<<",
    ">>",
    "|",
    "^",
    "&",
    "@",
)

AUGMENTED_ASSIGN_OPS: Final[Tuple[str, ...]] = (
    "+=",
    "-=",
    "*=",
    "/=",
    "//=",
    "%=",
    "**=",
    "<<=",
    ">>=",
    "|=",
    "^=",
    "&=",
    "@=",
)


# --- Large function set to add line count ---


def validate_identifier(name: str) -> bool:
    """Check if a string is a valid Python identifier."""
    if not name:
        return False
    if name[0].isdigit():
        return False
    return all(c.isalnum() or c == "_" for c in name)


def escape_string(s: str, quote: str = '"') -> str:
    """Escape a string for Python source output."""
    result = s.replace("\\", "\\\\")
    result = result.replace(quote, "\\" + quote)
    result = result.replace("\n", "\\n")
    result = result.replace("\r", "\\r")
    result = result.replace("\t", "\\t")
    return f"{quote}{result}{quote}"


def indent_code(code: str, level: int = 1, indent: str = DEFAULT_INDENT) -> str:
    """Indent each line of code by the given level."""
    prefix = indent * level
    lines = code.split("\n")
    return "\n".join(prefix + line if line.strip() else line for line in lines)


def strip_comments(source: str) -> str:
    """Remove line comments from Python source code (naive)."""
    lines = source.split("\n")
    result: List[str] = []
    for line in lines:
        in_string = False
        quote_char = ""
        comment_start = -1
        i = 0
        while i < len(line):
            ch = line[i]
            if in_string:
                if ch == "\\" and i + 1 < len(line):
                    i += 2
                    continue
                if ch == quote_char:
                    in_string = False
            else:
                if ch in ('"', "'"):
                    in_string = True
                    quote_char = ch
                elif ch == "#":
                    comment_start = i
                    break
            i += 1
        if comment_start >= 0:
            result.append(line[:comment_start].rstrip())
        else:
            result.append(line)
    return "\n".join(result)


def count_lines(source: str) -> Dict[str, int]:
    """Count types of lines in a source file."""
    lines = source.split("\n")
    total = len(lines)
    blank = sum(1 for l in lines if not l.strip())
    comment = sum(1 for l in lines if l.strip().startswith("#"))
    code = total - blank - comment
    return {
        "total": total,
        "blank": blank,
        "comment": comment,
        "code": code,
    }


def find_all_names(source: str) -> List[str]:
    """Find all potential identifiers in source (naive regex-free scan)."""
    names: List[str] = []
    current = ""
    for ch in source:
        if ch.isalnum() or ch == "_":
            current += ch
        else:
            if current and not current[0].isdigit():
                names.append(current)
            current = ""
    if current and not current[0].isdigit():
        names.append(current)
    return deduplicate(names)


def build_scope_chain(node: BaseNode) -> List[str]:
    """Build a list of enclosing scope names for a given node."""
    chain: List[str] = []
    current: Optional[BaseNode] = node
    while current is not None:
        if isinstance(current, (FunctionDef, ClassDef)):
            chain.append(current.name)
        elif isinstance(current, Module):
            chain.append(current.name)
        current = current._parent
    chain.reverse()
    return chain


def compute_complexity(node: BaseNode) -> int:
    """Compute a naive cyclomatic complexity for a node."""
    complexity = 1
    for child in node.walk():
        if isinstance(child, (IfStatement, ForStatement, WhileStatement)):
            complexity += 1
        elif isinstance(child, TryStatement):
            complexity += len(child.handlers)
        elif isinstance(child, (BinaryOp,)) and child.op in BOOLEAN_OPS:
            complexity += 1
    return complexity


# --- Type alias collection ---

JsonPrimitive = Union[str, int, float, bool, None]
JsonArray = List["JsonValue"]
JsonObject = Dict[str, "JsonValue"]
JsonValue = Union[JsonPrimitive, JsonArray, JsonObject]

HttpMethod = Literal["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]
StatusCode = Literal[200, 201, 204, 301, 302, 400, 401, 403, 404, 500, 502, 503]

Color = Tuple[int, int, int]
ColorWithAlpha = Tuple[int, int, int, float]
AnyColor = Union[Color, ColorWithAlpha, str]

Point2D = Tuple[float, float]
Point3D = Tuple[float, float, float]
BoundingBox = Tuple[Point2D, Point2D]
BoundingBox3D = Tuple[Point3D, Point3D]

Matrix = List[List[float]]
SparseMatrix = Dict[Tuple[int, int], float]

PathLike = Union[str, os.PathLike[str]]

Callback = typing.Callable[[], None]
ErrorHandler = typing.Callable[[Exception], bool]
Predicate = typing.Callable[[Any], bool]
Comparator = typing.Callable[[Any, Any], int]
Transformer = typing.Callable[[_T], _T]

# End of large_stdlib.py
