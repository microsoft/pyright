# This sample validates that lambdas declared within a class
# body do not reference class-scoped variables within the
# lambda return expression.


var1 = [1, 2]


class A:
    x1 = lambda: var1

    var2 = [1, 2]

    # This should generate an error.
    x2 = lambda: var2
