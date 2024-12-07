# This sample tests a case where the constraint solver generates a very
# "deep" tuple type. Previously, this caused a hang in the evaluator.

from typing import Callable


def func1[T](c: Callable[[T], T]): ...


# This should generate an error, not hang.
func1(lambda v: (v, v))
