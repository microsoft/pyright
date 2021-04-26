# This sample tests that a module is treated as though it's derived
# from 'object' from the perspective of the type checker.

import typing


def func1(a: object):
    pass


func1(typing)

dir(typing)
