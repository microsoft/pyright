# This sample tests the case where a function with a ParamSpec
# is assigned to another function with a Concatenate and a ParamSpec.

from typing import Any, Concatenate, Callable


class MyGeneric[**P0]:
    def __call__(self, *args: P0.args, **kwargs: P0.kwargs) -> Any: ...


def deco1[**P1](func: Callable[[Callable[P1, Any]], Any]) -> MyGeneric[P1]: ...


@deco1
def func1[**P2](func: Callable[Concatenate[int, P2], Any]): ...


reveal_type(func1, expected_text="MyGeneric[(int, **P2@func1)]")


v1: MyGeneric[[int]] = func1

# This should generate an error.
v2: MyGeneric[[int, int]] = func1
