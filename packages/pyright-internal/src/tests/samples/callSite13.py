# This sample tests that call-site return type inference ignores the
# unreachable branch of a statically evaluated operand when it computes
# code flow complexity.


def func1(a, b):
    b = b or {}
    b = b or {}
    b = b or {}
    b = b or {}
    return a


reveal_type(func1(1, None), expected_text="Literal[1]")


def func2(a, b):
    b = 0 or b
    b = 0 or b
    b = 0 or b
    b = 0 or b
    return a


reveal_type(func2(1, None), expected_text="Literal[1]")


def func3(a, b):
    b = b or {}
    b = b or {}
    b = b or {}
    b = b or {}
    b = b or {}
    b = b or {}
    b = b or {}
    b = b or {}
    return a


reveal_type(func3(1, None), expected_text="Unknown")


def func4(a, b):
    b = b or a
    b = b or a
    b = b or a
    b = b or a
    return a


reveal_type(func4(1, None), expected_text="Unknown")
