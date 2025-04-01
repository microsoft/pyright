# This sample tests that the type printer prints fully-qualified names
# for types that are ambiguous because they have the same local name.

from . import typePrinter2


class A:
    class Inner: ...


class B:
    class Inner: ...


def func1(v: A.Inner | None):
    reveal_type(v, expected_text="Inner | None")


def func2(v: A.Inner | B.Inner | None):
    reveal_type(v, expected_text="typePrinter1.A.Inner | typePrinter1.B.Inner | None")


class IntOrStr: ...


def func3(v: typePrinter2.IntOrStr | IntOrStr | None):
    reveal_type(v, expected_text="int | str | IntOrStr | None")
