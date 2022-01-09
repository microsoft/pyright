# This sample tests the verification that overload implementation signatures
# are a superset of their associated overload signatures.

from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    Generic,
    Iterable,
    List,
    Literal,
    NoReturn,
    Optional,
    Tuple,
    Type,
    TypeVar,
    Union,
    overload,
)

# This should generate an error because its input parameter
# type is incompatible.
@overload
def func1(a: int) -> str:
    ...


# This should generate an error because its return parameter
# type is incompatible.
@overload
def func1(a: str) -> int:
    ...


def func1(a: str) -> str:
    return a


# This should generate an error because the parameter "b" is missing
# from the implementation.
@overload
def func2(a: int, b: str = ...) -> str:
    ...


@overload
def func2(a: None) -> str:
    ...


def func2(a: Optional[int]) -> str:
    ...


@overload
def func3(a: int, *, b: Literal["r"]) -> str:
    ...


@overload
def func3(a: int, *, b: Literal["b"]) -> bytes:
    ...


def func3(*args: Any, **kwargs: Any) -> Any:
    ...


_T = TypeVar("_T")


@overload
def func4(a: None) -> None:
    ...


@overload
def func4(a: List[_T]) -> _T:
    ...


def func4(a: Optional[List[_T]]) -> Optional[_T]:
    ...


class A:
    @overload
    def method4(self, a: None) -> None:
        ...

    @overload
    def method4(self, a: List[_T]) -> _T:
        ...

    def method4(self, a: Optional[List[_T]]) -> Optional[_T]:
        ...


@overload
def func5(a: List[_T]) -> _T:
    ...


@overload
def func5(a: None) -> None:
    ...


# This should generate an error because List is not compatible with Dict.
def func5(a: Optional[Dict[Any, Any]]) -> Optional[Any]:
    ...


@overload
def func6(foo: int, /) -> int:
    ...


@overload
def func6(bar: str, /) -> int:
    ...


def func6(p0: Union[int, str], /) -> int:
    return 3


_T1 = TypeVar("_T1")


class ClassA(Generic[_T1]):
    @overload
    def method1(self: "ClassA[None]") -> None:
        ...

    @overload
    def method1(self, value: _T1) -> None:
        ...

    def method1(self, value: Any = None) -> None:
        ...


class ClassB:
    ...


class ClassC:
    ...


_T2 = TypeVar("_T2", ClassB, ClassC)


@overload
def func7(cls: Type[ClassB], var: int) -> ClassB:
    ...


@overload
def func7(cls: Type[ClassC], var: str) -> ClassC:
    ...


def func7(cls: Type[_T2], var: Union[int, str]) -> _T2:
    return cls()


_T3 = TypeVar("_T3")


@overload
def func8(foo: int) -> int:
    ...


@overload
def func8(foo: _T3) -> Tuple[_T3]:
    ...


def func8(foo: Union[_T3, int]) -> Union[Tuple[_T3], int]:
    ...


class Foo:
    ...


_T4 = TypeVar("_T4", bound=Foo)


@overload
def func9() -> None:
    ...


@overload
def func9(bar: _T4) -> _T4:
    ...


def func9(bar: Optional[_T4] = None) -> Optional[_T4]:
    raise NotImplementedError


_T5 = TypeVar("_T5", int, str)


@overload
def func10(option: Literal["a"], var: str) -> str:
    ...


@overload
def func10(option: Literal["b"], var: int) -> str:
    ...


# This should generate an error.
def func10(option: Literal["a", "b"], var: _T5) -> _T5:
    ...


class X:
    ...


_T6 = TypeVar("_T6", bound=Type[X])


@overload
def func11(var: _T6) -> _T6:
    ...


@overload
def func11(var: int) -> int:
    ...


def func11(var: Union[_T6, int]) -> Union[_T6, int]:
    ...


_T7 = TypeVar("_T7")
_T8 = TypeVar("_T8")
_T9 = TypeVar("_T9")


@overload
def func12(func: Callable[[_T7], _T8], iterable: Iterable[_T7], /) -> Iterable[_T8]:
    ...


@overload
def func12(
    func: Callable[[_T7], _T8], iterable: Iterable[_T7], /, default_value: _T9
) -> Iterable[_T8 | _T9]:
    ...


def func12(
    func: Callable[[_T7], _T8],
    iterable: Iterable[_T7],
    /,
    default_value: _T9 = None,
) -> Iterable[_T8 | _T9]:
    ...


@overload
def func13(x: int) -> NoReturn:
    ...


@overload
def func13(x: str) -> str | NoReturn:
    ...


def func13(x: int | str) -> str:
    ...


_T14 = TypeVar("_T14")


class Wrapper1(Generic[_T14]):
    ...


@overload
def func14(target: Callable[..., Awaitable[_T14]]) -> Wrapper1[_T14]:
    ...


@overload
def func14(target: Callable[..., _T14]) -> Wrapper1[_T14]:
    ...


def func14(
    target: Callable[..., Awaitable[_T14]] | Callable[..., _T14]
) -> Wrapper1[_T14]:
    ...
