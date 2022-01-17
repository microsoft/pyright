# This sample tests the case where an assignment expression target
# is found within a function decorator or a function default value expression.

from typing import Any, Callable, List, TypeVar


_T = TypeVar("_T")


def decorator(*args: Any, **kwargs: Any) -> Callable[[_T], _T]:
    ...


@decorator(
    [
        walrus_target_1
        for combination in [[1]]
        if None not in (walrus_target_1 := set(combination))
    ],
)
def decorated(
    x: List[str] = [x for x in ["a", "b"] if x in (walrus_target_2 := ["a", "b"])]
):
    pass


reveal_type(walrus_target_1, expected_text="set[int]")
reveal_type(walrus_target_2, expected_text="list[str]")
