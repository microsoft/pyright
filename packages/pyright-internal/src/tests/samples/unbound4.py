# This sample tests that an unbound variable that is generated in
# a function does not propagate beyond that function to callers.


def func1():
    # This should generate an error
    return a


# This should not.
b = func1()
reveal_type(b, expected_text="Unknown")


def func2(val: int):
    if val < 3:
        return val

    # This should generate an error
    return a


# This should not.
c = func2(36)
reveal_type(c, expected_text="int | Unknown")
