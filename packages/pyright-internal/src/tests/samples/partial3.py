# This sample tests that the functools.partial special-case logic
# properly handles bidirectional type inference for argument evaluation.

from functools import partial


class BaseClass:
    pass


class SubClass(BaseClass):
    pass


def func_base(base: BaseClass):
    pass


def func_list(base: list[BaseClass]):
    pass


def func_set(base: set[BaseClass]):
    pass


sub = SubClass()

partial(func_base, sub)
partial(func_list, [sub])
partial(func_set, {sub})
