# This sample tests the verification that overload implementation signatures
# are a superset of their associated overload signatures.

from typing import (
    Any,
    Callable,
    Generic,
    Literal,
    ParamSpec,
    Protocol,
    TypeVar,
    TypeVarTuple,
    overload,
)


T = TypeVar("T")
T_contra = TypeVar("T_contra", contravariant=True)
T_co = TypeVar("T_co", covariant=True)
TCall = TypeVar("TCall", bound=Callable[..., Any])
R = TypeVar("R")
P = ParamSpec("P")
Ts = TypeVarTuple("Ts")


class ClassA(Protocol[T_co]):
    _target_: str


class ClassB(ClassA[T_co], Protocol[T_co, P]):
    def __init__(self, *args: P.args, **kwds: P.kwargs): ...


class ClassC(Protocol):
    # This should generate a overlapping overload error.
    @overload
    def __call__(
        self,
        x: Callable[P, R],
        *,
        sig: Literal[True] = ...,
    ) -> ClassB[type[R], P]: ...

    @overload
    def __call__(
        self, x: TCall, *, sig: Literal[False] = ...
    ) -> ClassA[type[TCall]]: ...

    @overload
    def __call__(
        self, x: TCall | Callable[P, R], *, sig: bool
    ) -> ClassA[type[TCall]] | ClassB[type[R], P]: ...

    def __call__(
        self, x: TCall | Callable[P, R], *, sig: bool = False
    ) -> ClassA[type[TCall]] | ClassB[type[R], P]: ...


Func = Callable[[*Ts], None]


@overload
def func1(function: Func[*Ts]) -> Func[*Ts]: ...


@overload
def func1() -> Callable[[Func[*Ts]], Func[*Ts]]: ...


def func1(
    function: Func[*Ts] | None = None,
) -> Func[*Ts] | Callable[[Func[*Ts]], Func[*Ts]]: ...


@overload
def func2(d: dict[str, float], /) -> None: ...


@overload
def func2(**kwargs: float) -> None: ...


def func2(d: dict[str, float] | None = None, /, **kwargs: float) -> None:
    pass


@overload
def func3(a: int) -> int: ...


@overload
def func3(*args: int) -> int: ...


# This should generate an error because the keyword parameter "a" is missing.
def func3(*args: int) -> int: ...


@overload
def func4(a: int) -> int: ...


@overload
def func4(*args: int) -> int: ...


def func4(*args: int, a: int = 1) -> int: ...


@overload
def func5(a: int) -> int: ...


@overload
def func5(*args: int) -> int: ...


def func5(*args: int, **kwargs: int) -> int: ...


@overload
def func6(x: tuple[()], /) -> None: ...


@overload
def func6(x: tuple[object], /) -> None: ...


def func6(x: tuple[object, ...], /) -> None: ...


class ClassD(Generic[T_contra]):
    def method(self, x: T_contra) -> int:
        assert False


@overload
def func7(x: None) -> int: ...


@overload
def func7(x: ClassD[T]) -> int: ...


def func7(x: ClassD[T] | None) -> int:
    assert False
