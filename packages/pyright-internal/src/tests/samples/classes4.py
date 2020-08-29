# This sample tests the type checker's ability to handle
# class variables that redefine a symbol in an outer
# scope but are not defined with an explicit class
# variable statement.

class Foo:
    bar: str = "hi"

    def __init__(self, baz: str) -> None:
        self.str = baz

    @classmethod
    def from_baz(cls, baz: str) -> None:
        cls.str = baz

        
