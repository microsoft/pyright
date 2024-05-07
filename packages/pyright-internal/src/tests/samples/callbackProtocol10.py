# This sample tests the case where a callback protocol uses
# a (*args: Any, **kwargs: Any) signature.


from typing import Any, Callable, Concatenate, ParamSpec, Protocol, TypeVar

P = ParamSpec("P")
T_contra = TypeVar("T_contra", contravariant=True)


class Proto1(Protocol):
    def __call__(self, *args, **kwargs) -> None: ...


class Proto2(Protocol):
    def __call__(self, a: int, /, *args, **kwargs) -> None: ...


class Proto3(Protocol):
    def __call__(self, a: int, *args: Any, **kwargs: Any) -> None: ...


class Proto4(Protocol[P]):
    def __call__(self, a: int, *args: P.args, **kwargs: P.kwargs) -> None: ...


class Proto5(Protocol[T_contra]):
    def __call__(self, *args: T_contra, **kwargs: T_contra) -> None: ...


class Proto6(Protocol):
    def __call__(self, a: int, /, *args: Any, k: str, **kwargs: Any) -> None:
        pass


class Proto7(Protocol):
    def __call__(self, a: float, /, b: int, *, k: str, m: str) -> None:
        pass


def func(
    p1: Proto1,
    p2: Proto2,
    p3: Proto3,
    p4: Proto4[...],
    p5: Proto5[Any],
    p7: Proto7,
    c1: Callable[..., None],
    c2: Callable[Concatenate[int, ...], None],
):
    x1: Callable[..., None] = p1
    x2: Proto1 = c1
    x3: Callable[..., None] = p5
    x4: Proto5[Any] = c1
    x5: Callable[Concatenate[int, ...], None] = p2
    x6: Proto2 = c2
    x7: Callable[..., None] = p3
    x8: Proto3 = c1
    x9: Proto4[...] = p3
    x10: Proto3 = p4
    x11: Proto6 = p7
