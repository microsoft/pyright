# This sample validates that the exception type provided
# within a raise statement is valid.

from random import random


a: bool = True if random() > 0.5 else False


class CustomException1(BaseException):
    def __init__(self, code: int):
        pass


# This should generate an error because CustomException1
# requires an argument to instantiate.
if a or 2 > 1:
    raise CustomException1

if a or 2 > 1:
    raise CustomException1(3)


class CustomException2:
    pass


# This should generate an error because
# the exception doesn't derive from BaseException.
if a or 2 > 1:
    raise CustomException2


def func1(x1: type[BaseException], x2: type[BaseException]):
    if 2 > 1:
        raise x1 from None

    if 2 > 1:
        raise x1 from x2

    if 2 > 1:
        # This should generate an error because the exception
        # type doesn't derive from BaseException.
        raise 1 from x2

    if 2 > 1:
        # This should generate an error because the exception
        # type doesn't derive from BaseException.
        raise ValueError from 1
