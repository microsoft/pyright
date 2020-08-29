# This sample tests that the type checker properly handles
# types of args and kwargs correctly.

from typing import Dict, Hashable, Tuple


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

