# This sample tests various type checking operations relating to
# generator functions where the return type is inferred.


class ClassA:
    pass


class ClassB:
    pass


def generator1():
    yield ClassB()


reveal_type(generator1(), expected_text="Generator[ClassB, Any, None]")


def generator2():
    yield "Hello"
    yield ClassA()
    return 3


reveal_type(
    generator2(), expected_text="Generator[ClassA | Literal['Hello'], Any, Literal[3]]"
)


def generator3():
    x = yield 3
    return 0


reveal_type(generator3(), expected_text="Generator[Literal[3], Unknown, Literal[0]]")


def consumer1() -> ClassB:
    return next(generator1())


def consumer2() -> ClassA:
    # This should generate an error because the
    # inferred type of generator1 should be incompatible
    # with ClassA.
    return next(generator1())


def consumer3() -> ClassA | None:
    value = next(generator2())

    if isinstance(value, str):
        print(str)
    else:
        return value


def generator4():
    return
    yield 1


reveal_type(generator4(), expected_text="Generator[Never, Any, None]")
