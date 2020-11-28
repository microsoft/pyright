# This sample tests the handling of a circular dependency
# when resolving a type annotation.


class Example1:
    # This should not generate an error because "int"
    # is not forward-declared.
    int: int = 4

    # This should generate an error because int is no
    # longer a reference to the outer-scoped symbol.
    test: int


class Example2:
    # This should generate an error because it's forward-declared.
    int: "int" = 4
