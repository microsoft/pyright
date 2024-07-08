# This sample tests the reportInconsistentConstructor diagnostic check.


class Parent1:
    def __init__(self, a: int) -> None:
        ...


class Child1(Parent1):
    # This should generate an error if reportInconsistentConstructor is enabled.
    def __new__(cls, a: int | str):
        ...


class Parent2:
    def __init__(self, b: int) -> None:
        ...


class Child2(Parent2):
    # This should generate an error if reportInconsistentConstructor is enabled.
    def __new__(cls, b: str):
        ...
