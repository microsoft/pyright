# This sample tests the case where an unannotated local variable
# has a dependency on itself when evaluating its effective type.


def func1(arg: str): ...


def func2(arg: int):
    for _ in range(1):
        loc = arg
        loc = loc if loc else loc

        # This should generate an error.
        func1(loc)
