# This sample checks the handling of callable types that are narrowed
# to a particular type using an isinstance type narrowing test.

from typing import Callable, Literal, Union


class Foo:
    def __call__(self, arg: int, bar: str) -> None:
        raise NotImplementedError


class Bar:
    def __call__(self, arg: int) -> None:
        raise NotImplementedError


class Baz:
    def __call__(self, arg: str) -> None:
        raise NotImplementedError


def check_foo_or_bar(
    val: Union[Callable[[int, str], None], Callable[[int], None]]
) -> bool:
    if isinstance(val, Foo):
        t1: Literal["Foo"] = reveal_type(val)
        print("Foo!")
        return True

    if isinstance(val, Bar):
        t2: Literal["Bar"] = reveal_type(val)
        print("Bar!")
        return True

    if isinstance(val, Baz):
        t3: Literal["Never"] = reveal_type(val)
        print("Baz!")
        return True

    t4: Literal["(_p0: int, _p1: str) -> None | (_p0: int) -> None"] = reveal_type(
        val
    )

    return False
