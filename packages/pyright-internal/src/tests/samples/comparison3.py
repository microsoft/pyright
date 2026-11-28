# This sample tests the reportUnnecessaryComparison diagnostic check
# when the left operand's __eq__ is assigned to an instance.


class A: ...


class ClassWithInstanceEq:
    def __init__(self) -> None:
        self.__eq__ = lambda other: True


def func1(a: A, f: ClassWithInstanceEq):
    # This should generate an error if reportUnnecessaryComparison is enabled.
    if f == a:
        pass
