# This sample tests that the type checker properly handles
# types of args and kwargs correctly.

from typing import Any, Dict, Hashable, Mapping, Tuple


def requires_hashable_tuple(p1: Tuple[Hashable, ...]):
    ...


def requires_hashable_dict(p1: Dict[str, Hashable]):
    ...


def test_args(*args: Hashable):
    if args:
        aaa = list(args)
        bbb = tuple(aaa)
        args = bbb
    requires_hashable_tuple(args)


def test_kwargs(**kwargs: Hashable):
    requires_hashable_dict(kwargs)


def test_kwargs2(
    a: Mapping[str, Any],
    b: Mapping[Any, Hashable],
    c: Dict[str, Hashable],
    d: int,
    e: Mapping[int, Hashable],
    f: Tuple[str, ...],
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
