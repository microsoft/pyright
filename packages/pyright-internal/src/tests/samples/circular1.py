# This sample tests the handling of a circular dependency
# when resolving a type annotation.


class Example1:
    str: str = ""

    int = int

    test: int


class Example2:
    int: "int" = 4
