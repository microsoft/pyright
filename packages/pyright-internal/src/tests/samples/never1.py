# This sample verifies that "Never" doesn't appear in
# an inferred function return type.


def func1(a: str = ""):
    if not isinstance(a, str):
        reveal_type(a, expected_text="Never")
        return [a]


x1 = func1()
reveal_type(x1, expected_text="list[Unknown] | None")
