# This sample tests the handling of a circular dependency
# when resolving a type annotation.


class Example1:
    # This should generate two errors because the annotation
    # in this case refers to the local variable, which creates
    # a circular reference and uses an illegal variable in an
    # annotation.
    str: str = ""

    int = int

    test: int


class Example2:
    int: "int" = 4
