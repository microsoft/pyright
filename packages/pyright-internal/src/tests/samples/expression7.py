# This sample tests various conditions with AND and OR operators.


def func1() -> bool:
    ...


def func2() -> int:
    ...


def func3() -> str:
    ...


reveal_type(func1() and func2(), expected_text="int | Literal[False]")
reveal_type(func1() and func3(), expected_text="str | Literal[False]")
reveal_type(func2() and func1(), expected_text="bool | Literal[0]")
reveal_type(func3() and func1(), expected_text="bool | Literal['']")

reveal_type(func1() or func2(), expected_text="int | Literal[True]")
reveal_type(func1() or func3(), expected_text="str | Literal[True]")
reveal_type(func2() or func1(), expected_text="int | bool")
reveal_type(func3() or func1(), expected_text="str | bool")


class ClassA:
    ...


class ClassB:
    ...


def func4(a: ClassA and ClassB):
    reveal_type(a, expected_text="ClassB")


def func5(a: ClassA or ClassB):
    reveal_type(a, expected_text="ClassA")
