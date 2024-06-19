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
