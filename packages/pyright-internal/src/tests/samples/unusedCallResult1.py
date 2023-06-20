# This sample tests the reportUnusedCallResult diagnostic rule.

from typing import Any, Iterable


def func1():
    pass


def func2():
    raise RuntimeError()


def func3() -> Any:
    pass


def func4():
    return 3


def func5(a: int) -> int | list[int]:
    if a < 0:
        return 5
    return [3]


def func6() -> Iterable[int]:
    return []


func1()


def aaa():
    func2()


func3()


# This should generate a diagnostic if reportUnusedCallResult is enabled.
func4()

# This should generate a diagnostic if reportUnusedCallResult is enabled.
func5(3)

# This should generate a diagnostic if reportUnusedCallResult is enabled.
func6()

_, _ = func5(3), func6()

_ = func5(3)

_ = func5(func4())

for _ in func6():
    pass


async def get_string_async() -> str:
    return "A string"


async def await_string() -> None:
    # This should generate a diagnostic if reportUnusedCallResult is enabled.
    await get_string_async()
