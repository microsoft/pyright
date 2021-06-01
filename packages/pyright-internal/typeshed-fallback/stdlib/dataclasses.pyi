import sys
from typing import Any, Callable, Dict, Generic, Iterable, List, Mapping, Optional, Tuple, Type, TypeVar, Union, overload

if sys.version_info >= (3, 9):
    from types import GenericAlias

_T = TypeVar("_T")

class _MISSING_TYPE: ...

MISSING: _MISSING_TYPE

if sys.version_info >= (3, 10):
    class _KW_ONLY_TYPE: ...
    KW_ONLY: _KW_ONLY_TYPE

@overload
def asdict(obj: Any) -> Dict[str, Any]: ...
@overload
def asdict(obj: Any, *, dict_factory: Callable[[List[Tuple[str, Any]]], _T]) -> _T: ...
@overload
def astuple(obj: Any) -> Tuple[Any, ...]: ...
@overload
def astuple(obj: Any, *, tuple_factory: Callable[[List[Any]], _T]) -> _T: ...

if sys.version_info >= (3, 10):
    @overload
    def dataclass(__cls: Type[_T]) -> Type[_T]: ...
    @overload
    def dataclass(__cls: None) -> Callable[[Type[_T]], Type[_T]]: ...
    @overload
    def dataclass(
        *,
        init: bool = ...,
        repr: bool = ...,
        eq: bool = ...,
        order: bool = ...,
        unsafe_hash: bool = ...,
        frozen: bool = ...,
        match_args: bool = ...,
        kw_only: bool = ...,
        slots: bool = ...,
    ) -> Callable[[Type[_T]], Type[_T]]: ...

elif sys.version_info >= (3, 8):
    # cls argument is now positional-only
    @overload
    def dataclass(__cls: Type[_T]) -> Type[_T]: ...
    @overload
    def dataclass(__cls: None) -> Callable[[Type[_T]], Type[_T]]: ...
    @overload
    def dataclass(
        *, init: bool = ..., repr: bool = ..., eq: bool = ..., order: bool = ..., unsafe_hash: bool = ..., frozen: bool = ...
    ) -> Callable[[Type[_T]], Type[_T]]: ...

else:
    @overload
    def dataclass(_cls: Type[_T]) -> Type[_T]: ...
    @overload
    def dataclass(_cls: None) -> Callable[[Type[_T]], Type[_T]]: ...
    @overload
    def dataclass(
        *, init: bool = ..., repr: bool = ..., eq: bool = ..., order: bool = ..., unsafe_hash: bool = ..., frozen: bool = ...
    ) -> Callable[[Type[_T]], Type[_T]]: ...

class Field(Generic[_T]):
    name: str
    type: Type[_T]
    default: _T
    default_factory: Callable[[], _T]
    repr: bool
    hash: Optional[bool]
    init: bool
    compare: bool
    metadata: Mapping[str, Any]
    if sys.version_info >= (3, 10):
        kw_only: bool
        def __init__(
            self,
            default: _T,
            default_factory: Callable[[], _T],
            init: bool,
            repr: bool,
            hash: Optional[bool],
            compare: bool,
            metadata: Mapping[str, Any],
            kw_only: bool,
        ) -> None: ...
    else:
        def __init__(
            self,
            default: _T,
            default_factory: Callable[[], _T],
            init: bool,
            repr: bool,
            hash: Optional[bool],
            compare: bool,
            metadata: Mapping[str, Any],
        ) -> None: ...
    if sys.version_info >= (3, 9):
        def __class_getitem__(cls, item: Any) -> GenericAlias: ...

# NOTE: Actual return type is 'Field[_T]', but we want to help type checkers
# to understand the magic that happens at runtime.
if sys.version_info >= (3, 10):
    @overload  # `default` and `default_factory` are optional and mutually exclusive.
    def field(
        *,
        default: _T,
        init: bool = ...,
        repr: bool = ...,
        hash: Optional[bool] = ...,
        compare: bool = ...,
        metadata: Optional[Mapping[str, Any]] = ...,
        kw_only: bool = ...,
    ) -> _T: ...
    @overload
    def field(
        *,
        default_factory: Callable[[], _T],
        init: bool = ...,
        repr: bool = ...,
        hash: Optional[bool] = ...,
        compare: bool = ...,
        metadata: Optional[Mapping[str, Any]] = ...,
        kw_only: bool = ...,
    ) -> _T: ...
    @overload
    def field(
        *,
        init: bool = ...,
        repr: bool = ...,
        hash: Optional[bool] = ...,
        compare: bool = ...,
        metadata: Optional[Mapping[str, Any]] = ...,
        kw_only: bool = ...,
    ) -> Any: ...

else:
    @overload  # `default` and `default_factory` are optional and mutually exclusive.
    def field(
        *,
        default: _T,
        init: bool = ...,
        repr: bool = ...,
        hash: Optional[bool] = ...,
        compare: bool = ...,
        metadata: Optional[Mapping[str, Any]] = ...,
    ) -> _T: ...
    @overload
    def field(
        *,
        default_factory: Callable[[], _T],
        init: bool = ...,
        repr: bool = ...,
        hash: Optional[bool] = ...,
        compare: bool = ...,
        metadata: Optional[Mapping[str, Any]] = ...,
    ) -> _T: ...
    @overload
    def field(
        *,
        init: bool = ...,
        repr: bool = ...,
        hash: Optional[bool] = ...,
        compare: bool = ...,
        metadata: Optional[Mapping[str, Any]] = ...,
    ) -> Any: ...

def fields(class_or_instance: Any) -> Tuple[Field[Any], ...]: ...
def is_dataclass(obj: Any) -> bool: ...

class FrozenInstanceError(AttributeError): ...

class InitVar(Generic[_T]):
    type: Type[_T]
    def __init__(self, type: Type[_T]) -> None: ...
    if sys.version_info >= (3, 9):
        @overload
        def __class_getitem__(cls, type: Type[_T]) -> InitVar[_T]: ...
        @overload
        def __class_getitem__(cls, type: Any) -> InitVar[Any]: ...

if sys.version_info >= (3, 10):
    def make_dataclass(
        cls_name: str,
        fields: Iterable[Union[str, Tuple[str, type], Tuple[str, type, Field[Any]]]],
        *,
        bases: Tuple[type, ...] = ...,
        namespace: Optional[Dict[str, Any]] = ...,
        init: bool = ...,
        repr: bool = ...,
        eq: bool = ...,
        order: bool = ...,
        unsafe_hash: bool = ...,
        frozen: bool = ...,
        match_args: bool = ...,
        slots: bool = ...,
    ) -> type: ...

else:
    def make_dataclass(
        cls_name: str,
        fields: Iterable[Union[str, Tuple[str, type], Tuple[str, type, Field[Any]]]],
        *,
        bases: Tuple[type, ...] = ...,
        namespace: Optional[Dict[str, Any]] = ...,
        init: bool = ...,
        repr: bool = ...,
        eq: bool = ...,
        order: bool = ...,
        unsafe_hash: bool = ...,
        frozen: bool = ...,
    ) -> type: ...

def replace(__obj: _T, **changes: Any) -> _T: ...
