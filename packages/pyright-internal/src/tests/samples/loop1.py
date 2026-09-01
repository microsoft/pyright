# This sample tests the type checker's ability to handle type
# inferences within loop constructs.


def func1(a: list):
    pass


def func2():
    data = None

    for x in [2, 3]:
        if not data:
            data = [1, 2]
        else:
            reveal_type(data, expected_text="list[int]")
            func1(data)
    else:
        # With the change to treat non-empty list literals as guaranteed to execute,
        # data is definitely list[int] here (not None) because the loop executes at least once.
        reveal_type(data, expected_text="list[int]")

        # This should not generate an error because data is list[int]
        func1(data)


x = 20 + 20


def func3():
    data = None

    while x:
        if not data:
            data = [1, 2]
        else:
            reveal_type(data, expected_text="list[int]")
            func1(data)
    else:
        reveal_type(data, expected_text="list[int] | None")

        # This should generate an error because the
        # type checker should be able to determine that
        # data must contain None at this point.
        func1(data)
