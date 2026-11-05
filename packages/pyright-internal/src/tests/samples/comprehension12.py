# This sample tests unpacking in comprehensions (PEP 798), which is
# supported in Python 3.15 and newer.

from typing import Any, AsyncIterable, Mapping, TypedDict


class TD1(TypedDict):
    a: int
    b: str


def func1(a: list[list[int]], b: list[set[str]]) -> None:
    v1 = [*x for x in a]
    reveal_type(v1, expected_text="list[int]")

    v2 = {*x for x in b}
    reveal_type(v2, expected_text="set[str]")

    v3 = (*x for x in a)
    reveal_type(v3, expected_text="Generator[int, None, None]")

    v4 = list(*x for x in b)
    reveal_type(v4, expected_text="list[str]")

    v5: list[float] = [*x for x in a]
    reveal_type(v5, expected_text="list[float]")


def func2(
    a: list[dict[str, int]], b: list[Mapping[int, bytes]], c: list[Any], d: list[TD1]
) -> None:
    v1 = {**x for x in a}
    reveal_type(v1, expected_text="dict[str, int]")

    v2 = {**x for x in b}
    reveal_type(v2, expected_text="dict[int, bytes]")

    v3 = {**x for x in c}
    reveal_type(v3, expected_text="dict[Any, Any]")

    v4 = {**x for x in d}
    reveal_type(v4, expected_text="dict[str, object]")

    v5: dict[str, float] = {**x for x in a}
    reveal_type(v5, expected_text="dict[str, float]")


async def func3(a: AsyncIterable[list[int]]) -> None:
    v1 = [*x async for x in a]
    reveal_type(v1, expected_text="list[int]")


def func4(a: list[int], b: list[list[int]]) -> None:
    # This should generate an error.
    [*x for x in a]

    # This should generate an error.
    {**x for x in a}

    # This should generate an error.
    print(1, *x for x in b)

    # This should generate an error.
    [(*x) for x in b]

    # This should generate an error.
    {*x: 1 for x in b}
