# This sample tests the logic that infers parameter types based on
# default argument values or annotated base class methods.


class Parent:
    def func1(self, a: int, b: str) -> float:
        ...


class Child(Parent):
    def func1(self, a, b):
        reveal_type(self, expected_text="Self@Child")
        reveal_type(a, expected_text="int")
        reveal_type(b, expected_text="str")
        return a


def func2(a, b=0, c=None):
    reveal_type(a, expected_text="Unknown")
    reveal_type(b, expected_text="int")
    reveal_type(c, expected_text="Unknown | None")


def func3(a=(1, 2), b=[1,2], c={1: 2}):
    reveal_type(a, expected_text="Unknown")
    reveal_type(b, expected_text="Unknown")
    reveal_type(c, expected_text="Unknown")
