# This sample tests the interplay between unbound symbol detection and
# the code that handles conditional narrowing of captured variables.

from random import random


if random() > 0.5:
    from datetime import datetime
    from math import cos

# The following should generate an error because datetime
# is "narrowed" across execution scopes.
test0 = lambda: datetime


def test1():
    # The following should generate an error because datetime
    # is "narrowed" across execution scopes.
    return datetime


test2 = lambda: cos


def test2():
    return cos


# This modification means that cos will not be narrowed
# across execution scopes.
cos = None
