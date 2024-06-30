# This sample tests the "complexity" calculation in the constraint
# solver to select the less-complex solution.

from typing import Callable, Generic, Protocol, TypeVar

T = TypeVar("T")
S = TypeVar("S")
T_contra = TypeVar("T_contra", contravariant=True)
TResult = TypeVar("TResult")


class ResolveFunc(Protocol[T_contra]):
    def __call__(self, resolve_value: T_contra) -> None: ...


FullfillFunc = Callable[[T], TResult | "Promise[TResult]"]
ExecutorFunc = Callable[[ResolveFunc[T]], None]


class Promise(Generic[T]):
    @staticmethod
    def resolve(resolve_value: S) -> "Promise[S]": ...

    def __init__(self, executor_func: ExecutorFunc[T]) -> None: ...

    def then(self, onfullfilled: FullfillFunc[T, TResult]) -> "Promise[TResult]": ...


Promise.resolve(1).then(lambda result: reveal_type(result, expected_text="int"))

Promise.resolve(1).then(lambda result: "abc").then(
    lambda result: reveal_type(result, expected_text="str")
)

Promise.resolve(None).then(lambda result: Promise.resolve("abc" or 123)).then(
    lambda result: reveal_type(result, expected_text="str | int")
)

Promise.resolve(None).then(lambda result: "abc" or 123).then(
    lambda result: reveal_type(result, expected_text="int | str")
)
