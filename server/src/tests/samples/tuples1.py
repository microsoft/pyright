# This sample file tests various aspects of type analysis for tuples.

from typing import Tuple
import os

def func1() -> Tuple[int, int, int]:
    a = 1, 2, 3

    # This should generate an error because
    # of a tuple size mismatch.
    b, c = a

    b, c, d = a

    # This should generate an error because
    # of a tuple size mismatch.
    b, c, d, e, = a

    return a


def func2() -> Tuple[int, int, str]:
    a = 1, 2, 3

    # This should generate an error because the
    # number of items does not match.
    return a

def func3() -> Tuple[str, ...]:
    a = "1", 2, 3
    return a

def func4() -> Tuple[str, ...]:
    a = (1,)

    # This should generate an error because the first
    # item in the tuple isn't a string.
    return a

def func6():
    a = 1, 2, 'hello'
    a.index('1')

def func7(a: Tuple) -> Tuple[()]:
    return ()
 
def func7(a: tuple):
    a.index('1')
 

# Test the tuple specialization code. This
# should generate no error because split should
# be specialized to return a tuple of str values.
def func8() -> str:
    dirname, fname = os.path.split('dir/file')
    return dirname

