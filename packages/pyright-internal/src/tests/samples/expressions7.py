# This sample tests various conditions with AND and OR operators.

from typing import Literal


def foo() -> bool:
    ...


def bar() -> int:
    ...


def baz() -> str:
    ...


t1: Literal["int | Literal[False]"] = reveal_type(foo() and bar())
t2: Literal["str | Literal[False]"] = reveal_type(foo() and baz())
t3: Literal["int | bool"] = reveal_type(bar() and foo())
t4: Literal["str | bool"] = reveal_type(baz() and foo())

t5: Literal["int | Literal[True]"] = reveal_type(foo() or bar())
t6: Literal["str | Literal[True]"] = reveal_type(foo() or baz())
t7: Literal["int | bool"] = reveal_type(bar() or foo())
t8: Literal["str | bool"] = reveal_type(baz() or foo())


class Foo:
    ...


class Bar:
    ...


def func2(a: Foo and Bar):
    t1: Literal["Bar"] = reveal_type(a)


def func3(a: Foo or Bar):
    t1: Literal["Foo"] = reveal_type(a)
