# This sample tests various type checking operations relating to
# generator functions that use the "yield from" clause.

from typing import Iterator

class ClassA():
    pass

class ClassB():
    def shouldContinue(self):
        return True

class ClassC():
    pass

def generator1() -> Iterator[ClassA]:
    yield from generator1()


def generator2() -> Iterator[ClassB]:
    # This should generate an error because it yields
    # an iterator of the wrong type.
    yield from generator1()

    # This should also generate an error because it
    # yields the wrong type.
    yield from [1]


