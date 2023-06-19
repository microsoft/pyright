# This sample tests the case where a param with no default
# arg value can follow a param with a default arg value
# if they are both followed by a *args param.


def f(*a, b=1, c):
    pass
