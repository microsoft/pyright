# This sample tests the type analyzer's ability to determine
# execution paths.


def func1(length: int) -> int:
    n = 0
    while True:
        if n >= length:
            return n
        n += 3
    else:
        # This should not be flagged as an error
        # because we should never get here.
        return "hello"

    # This should not be flagged as an error
    # because we should never get here.
    return "not_returned"


def func2() -> int:
    while None:
        # This should not be flagged as an error
        # because we should never get here.
        return "hello"
    else:
        # This should be an error because the return
        # type doesn't match.
        return "hello"

    # This should not be an error because we
    # should never get here.
    return "not_returned"


def func3() -> str:
    if True:
        return "hello"
    else:
        # This should not be flagged as an error
        # because we should never get here.
        return 21

    raise BaseException()

    # This should not be flagged as an error
    # because we should never get here.
    return 52


def func4(length: int) -> int:
    n = 0
    while True:
        if n >= length:
            return n
        n += 3
        break
    else:
        return "hello"

    # This should be flagged as an error because
    # the break in the while True loop means that
    # we might get here, and the return type does
    # not match.
    return "not_returned"
