# This sample tests the case where a lambda's expression must be
# evaluated multiple times as more type information is gathered
# in the presence of an overloaded method.

# pyright: strict


def func1(keys: list[str]):
    filter(lambda s: s.startswith(""), keys)
