# This sample tests that underscore-prefixed variables are not reported as unused.


def func(_arg: int):
    _local = 1

    # This should generate both an error and an unused code diagnostic.
    regular = 1
