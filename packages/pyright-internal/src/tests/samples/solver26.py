# This sample tests that when an unspecialized generic class type is used as
# a constraint in the constraint solver, default type arguments (typically
# `Unknown`) are used.

from collections import defaultdict


def func1() -> None:
    d1 = defaultdict(list)
    reveal_type(d1, expected_text="defaultdict[Unknown, list[Unknown]]")
