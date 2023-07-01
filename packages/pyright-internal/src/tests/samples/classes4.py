# This sample tests the type checker's ability to handle
# class variables that redefine a symbol in an outer
# scope but are not defined with an explicit class
# variable statement.


class ClassA:
    bar: str = "hi"

    def __init__(self, val: str) -> None:
        self.str = val

    @classmethod
    def method1(cls, val: str) -> None:
        cls.str = val
