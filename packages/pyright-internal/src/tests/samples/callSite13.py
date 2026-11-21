# This sample tests that call-site return type inference ignores the
# unreachable branch of a statically falsy operand when it computes code
# flow complexity.


def func(a, b):
    b = b or {}
    b = b or {}
    b = b or {}
    b = b or {}
    return a


reveal_type(func(1, None), expected_text="Literal[1]")
