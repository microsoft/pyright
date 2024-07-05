# This sample tests that the type checker properly handles
# types of args and kwargs correctly.

from typing import Any, Hashable, Mapping, Protocol


def requires_hashable_tuple(p1: tuple[Hashable, ...]): ...


def requires_hashable_dict(p1: dict[str, Hashable]): ...


def test_args(*args: Hashable):
    if args:
        aaa = list(args)
        bbb = tuple(aaa)
        args = bbb
    requires_hashable_tuple(args)


def test_kwargs(**kwargs: Hashable):
    requires_hashable_dict(kwargs)


class StrSubclass(str): ...


def test_kwargs2(
    a: Mapping[str, Any],
    b: Mapping[Any, Hashable],
    c: dict[StrSubclass, Hashable],
    d: int,
    e: Mapping[int, Hashable],
    f: tuple[str, ...],
):
    test_kwargs(**a)
    test_kwargs(**b)
    test_kwargs(**c)

    # This should generate an error
    test_kwargs(**d)

    # This should generate an error
    test_kwargs(**e)

    # This should generate an error
    test_kwargs(**f)


class Callback1(Protocol):
    def __call__(self) -> None: ...


def func1(
    value: str = ...,
    *args: object,
) -> None: ...


def func2(
    value: str = ...,
    **kwargs: object,
) -> None: ...


def func3(
    value: str = ...,
    *args: object,
    **kwargs: object,
) -> None: ...


v1: Callback1 = func1
v2: Callback1 = func2
v3: Callback1 = func3
