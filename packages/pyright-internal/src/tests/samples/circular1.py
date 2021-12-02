# This sample tests the handling of a circular dependency
# when resolving a type annotation.


class Example1:
    # This should not generate an error because "int"
    # is not forward-declared.
    str: str = ""

    int = int

    test: int


class Example2:
    int: "int" = 4
