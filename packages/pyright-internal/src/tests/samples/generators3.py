# This sample tests various type checking operations relating to
# generator functions where the return type is inferred.

from typing import Optional

class ClassA():
    pass

class ClassB():
    pass


def generator1():
    yield ClassB()


def generator2():
    yield 'Hello'
    yield ClassA()
    return 3


def consumer1() -> ClassB:
    return next(generator1())


def consumer2() -> ClassA:
    # This should generate an error because the
    # inferred type of generator1 should be incompatible
    # with ClassA.
    return next(generator1())


def consumer3() -> Optional[ClassA]:
    value = next(generator2())

    if isinstance(value, str):
        print(str)
    else:
        return value

