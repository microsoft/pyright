# This sample tests the case where an unpacked TypeVarTuple is used
# as one or more type arguments for a tuple.

# Enable experimental features to support Union[*Ts].
# pyright: enableExperimentalFeatures=true

from typing import Generator, Iterable, TypeVar, TypeVarTuple, Union

T = TypeVar("T")
Ts = TypeVarTuple("Ts")


def func1(a: Iterable[T], b: Iterable[T]):
    i = iter(a)
    j = iter(b)
    while True:
        try:
            yield (next(i), next(j))
        except StopIteration:
            break


reveal_type(
    func1,
    expected_text="(a: Iterable[T@func1], b: Iterable[T@func1]) -> Generator[tuple[T@func1, T@func1], Any, None]",
)


def func2(a: tuple[*Ts], b: tuple[*Ts]):
    for i in func1(a, b):
        yield i


reveal_type(
    func2,
    expected_text="(a: tuple[*Ts@func2], b: tuple[*Ts@func2]) -> Generator[tuple[Union[*Ts@func2], Union[*Ts@func2]], Any, None]",
)


def func3():
    v1 = func2((1, "foo"), (2, "bar"))
    reveal_type(v1, expected_text="Generator[tuple[int | str, int | str], Any, None]")

    for i in v1:
        reveal_type(i, expected_text="tuple[int | str, int | str]")


def func5(x: "Iterable[Union[*Ts]]") -> Iterable[Union[*Ts]]: ...


def func6():
    v1: list[int] = [i for i in func5([1, 2, 3])]
    v2: list[int | str] = [i for i in func5([1, "foo"])]


def func7(t: "tuple[*Ts]") -> "tuple[Union[*Ts], ...]": ...


def func8(a: int, b: str):
    v1 = func7(((a, b),))
    reveal_type(v1, expected_text="tuple[tuple[int, str], ...]")


def func9(x: "tuple[T, ...]", y: "tuple[*Ts]") -> Generator[T | Union[*Ts], None, None]:
    z = x + y
    reveal_type(z, expected_text="tuple[T@func9 | Union[*Ts@func9], ...]")
    for e in z:
        reveal_type(e, expected_text="T@func9 | Union[*Ts@func9]")
        yield e


def func10(x: tuple[*Ts]): ...


def func11(x: tuple[*Ts, int, int]):
    func10(x)
