# This sample tests various conditions with AND and OR operators.


def foo() -> bool:
    ...


def bar() -> int:
    ...


def baz() -> str:
    ...


reveal_type(foo() and bar(), expected_text="int | Literal[False]")
reveal_type(foo() and baz(), expected_text="str | Literal[False]")
reveal_type(bar() and foo(), expected_text="int | bool")
reveal_type(baz() and foo(), expected_text="str | bool")

reveal_type(foo() or bar(), expected_text="int | Literal[True]")
reveal_type(foo() or baz(), expected_text="str | Literal[True]")
reveal_type(bar() or foo(), expected_text="int | bool")
reveal_type(baz() or foo(), expected_text="str | bool")


class Foo:
    ...


class Bar:
    ...


def func2(a: Foo and Bar):
    reveal_type(a, expected_text="Bar")


def func3(a: Foo or Bar):
    reveal_type(a, expected_text="Foo")
