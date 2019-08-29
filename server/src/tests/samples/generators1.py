# This sample tests various type checking operations relating to
# generator functions (those with a "yield" method).

from typing import Generator, Iterator

class ClassA():
    pass

s = True

class ClassB():
    def shouldContinue(self):
        global s
        return s

class ClassC():
    pass

def generator1() -> Generator[ClassA, ClassB, ClassC]:
    cont = ClassB()
    while cont.shouldContinue():
        cont = yield ClassA()

    return ClassC()


# This should generate an error because the function
# has no return statement at the bottom, so it
# returns None which is not assignable to ClassC.
def generator2() -> Generator[ClassA, ClassB, ClassC]:
    cont = ClassB()
    if cont.shouldContinue():
        # This should generate an error because False isn't
        # assignable to the return type (ClassC).
        return False

    while cont.shouldContinue():
        # This should generate an error because 3 isn't
        # assignable to the yeild type (ClassA).
        cont = yield 3


def generator3() -> Generator[ClassA]:
    cont = ClassB()
    if cont.shouldContinue():
        return 3

    while cont.shouldContinue():
        # This should generate an error because 3 isn't
        # assignable to the yeild type (ClassA).
        cont = yield 3


def generator4() -> Iterator[ClassA]:
    yield ClassA()

    return True


def generator5() -> Iterator[ClassA]:
    # This should generate an error because ClassB isn't
    # assignable to ClassA.
    yield ClassB()


def generate():
    for i in range(2):
        yield i
s = generate()

# Verify that a call to a Generator method succeeds
s.close()
