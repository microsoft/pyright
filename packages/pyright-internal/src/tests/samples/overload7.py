# This sample tests the verification that overload implementation signatures
# are a superset of their associated overload signatures.

from typing import (
    Any,
    Awaitable,
    Callable,
    Generic,
    Iterable,
    Literal,
    NoReturn,
    ParamSpec,
    Protocol,
    TypeVar,
    TypeVarTuple,
    overload,
)


# This should generate an error because its input parameter
# type is incompatible.
@overload
def func1(a: int) -> str: ...


# This should generate an error because its return parameter
# type is incompatible.
@overload
def func1(a: str) -> int: ...


def func1(a: str) -> str:
    return a


# This should generate an error because the parameter "b" is missing
# from the implementation.
@overload
def func2(a: int, b: str = ...) -> str: ...


@overload
def func2(a: None) -> str: ...


def func2(a: int | None) -> str: ...


@overload
def func3(a: int, *, b: Literal["r"]) -> str: ...


@overload
def func3(a: int, *, b: Literal["b"]) -> bytes: ...


def func3(*args: Any, **kwargs: Any) -> Any: ...


_T = TypeVar("_T")


@overload
def func4(a: None) -> None: ...


@overload
def func4(a: list[_T]) -> _T: ...


def func4(a: list[_T] | None) -> _T | None: ...


class A:
    @overload
    def method4(self, a: None) -> None: ...

    @overload
    def method4(self, a: list[_T]) -> _T: ...

    def method4(self, a: list[_T] | None) -> _T | None: ...


@overload
def func5(a: list[_T]) -> _T: ...


@overload
def func5(a: None) -> None: ...


# This should generate an error because List is not compatible with Dict.
def func5(a: dict[Any, Any] | None) -> Any | None: ...


@overload
def func6(foo: int, /) -> int: ...


@overload
def func6(bar: str, /) -> int: ...


def func6(p0: int | str, /) -> int:
    return 3


_T1 = TypeVar("_T1")


class ClassA(Generic[_T1]):
    @overload
    def method1(self: "ClassA[None]") -> None: ...

    @overload
    def method1(self, value: _T1) -> None: ...

    def method1(self, value: Any = None) -> None: ...


class ClassB: ...


class ClassC: ...


_T2 = TypeVar("_T2", ClassB, ClassC)


@overload
def func7(cls: type[ClassB], var: int) -> ClassB: ...


@overload
def func7(cls: type[ClassC], var: str) -> ClassC: ...


def func7(cls: type[_T2], var: int | str) -> _T2:
    return cls()


_T3 = TypeVar("_T3", bound=str)


@overload
def func8(foo: int) -> int: ...


@overload
def func8(foo: _T3) -> tuple[_T3]: ...


def func8(foo: _T3 | int) -> tuple[_T3] | int: ...


class Foo: ...


_T4 = TypeVar("_T4", bound=Foo)


@overload
def func9() -> None: ...


@overload
def func9(bar: _T4) -> _T4: ...


def func9(bar: _T4 | None = None) -> _T4 | None:
    raise NotImplementedError


_T5 = TypeVar("_T5", int, str)


@overload
def func10(option: Literal["a"], var: str) -> str: ...


@overload
def func10(option: Literal["b"], var: int) -> str: ...


# This should generate an error.
def func10(option: Literal["a", "b"], var: _T5) -> _T5: ...


class X: ...


_T6 = TypeVar("_T6", bound=type[X])


@overload
def func11(var: _T6) -> _T6: ...


@overload
def func11(var: int) -> int: ...


def func11(var: _T6 | int) -> _T6 | int: ...


_T7 = TypeVar("_T7")
_T8 = TypeVar("_T8")
_T9 = TypeVar("_T9")


@overload
def func12(
    func: Callable[[_T7], _T8], iterable: Iterable[_T7], default_value: None = None, /
) -> Iterable[_T8 | None]: ...


@overload
def func12(
    func: Callable[[_T7], _T8], iterable: Iterable[_T7], /, default_value: _T9
) -> Iterable[_T8 | _T9]: ...


def func12(
    func: Callable[[_T7], _T8],
    iterable: Iterable[_T7],
    /,
    default_value: _T9 = None,
) -> Iterable[_T8 | _T9]: ...


@overload
def func13(x: int) -> NoReturn: ...


@overload
def func13(x: str) -> str | NoReturn: ...


def func13(x: int | str) -> str: ...


_T14 = TypeVar("_T14")


class Wrapper1(Generic[_T14]): ...


@overload
def func14(target: Callable[..., Awaitable[_T14]]) -> Wrapper1[_T14]: ...


@overload
def func14(target: Callable[..., _T14]) -> Wrapper1[_T14]: ...


def func14(
    target: Callable[..., Awaitable[_T14]] | Callable[..., _T14]
) -> Wrapper1[_T14]: ...


@overload
def func15(client_id: str, client_secret: str, /) -> None: ...


@overload
def func15(client_id: str, client_secret: str) -> None: ...


# This should generate an error because some of the keyword arguments are not present.
def func15(*creds: str) -> None:
    pass


T1 = TypeVar("T1", covariant=True)
T2 = TypeVar("T2", bound=Callable[..., Any])
R = TypeVar("R")
P = ParamSpec("P")


class Builds(Protocol[T1]):
    _target_: str


class BuildsWithSig(Builds[T1], Protocol[T1, P]):
    def __init__(self, *args: P.args, **kwds: P.kwargs): ...


class ClassD(Protocol):
    @overload
    def __call__(
        self,
        x: Callable[P, R],
        *,
        sig: Literal[True] = ...,
    ) -> BuildsWithSig[type[R], P]: ...

    @overload
    def __call__(self, x: T2, *, sig: Literal[False] = ...) -> Builds[type[T2]]: ...

    @overload
    def __call__(
        self, x: T2 | Callable[P, R], *, sig: bool
    ) -> Builds[type[T2]] | BuildsWithSig[type[R], P]: ...

    def __call__(
        self, x: T2 | Callable[P, R], *, sig: bool = False
    ) -> Builds[type[T2]] | BuildsWithSig[type[R], P]: ...


Ts = TypeVarTuple("Ts")

Func = Callable[[*Ts], None]


@overload
def func16(function: Func[*Ts]) -> Func[*Ts]: ...
@overload
def func16() -> Callable[[Func[*Ts]], Func[*Ts]]: ...


def func16(
    function: Func[*Ts] | None = None,
) -> Func[*Ts] | Callable[[Func[*Ts]], Func[*Ts]]: ...


@overload
def func17(d: dict[str, float], /) -> None: ...


@overload
def func17(**kwargs: float) -> None: ...


def func17(d: dict[str, float] | None = None, /, **kwargs: float) -> None:
    pass


@overload
def func18(a: int) -> int: ...
@overload
def func18(*args: int) -> int: ...


# This should generate an error because the keyword parameter "a" is missing.
def func18(*args: int) -> int: ...


@overload
def func19(a: int) -> int: ...
@overload
def func19(*args: int) -> int: ...


def func19(*args: int, a: int = 1) -> int: ...


@overload
def func20(a: int) -> int: ...
@overload
def func20(*args: int) -> int: ...


def func20(*args: int, **kwargs: int) -> int: ...
