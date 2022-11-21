# This sample tests the handling of a circular dependency
# when resolving a type annotation.


class Example1:
    # This should generate two errors because "str" refers to itself
    # and it is a variable, so it's an illegal annotation.
    str: str = ""

    int = int

    test: int


class Example2:
    int: "int" = 4
