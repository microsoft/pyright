# This sample validates that list comprehensions within a class
# body do not reference class-scoped variables within the
# comprehension unless they are within the initial iterator expression.

outer_var = [1, 2]


class A:
    var1 = [1, 2]
    var2 = {x for x in var1}

    # This should generate an error.
    var3 = {var1[0] for x in var1}

    var4 = {outer_var[0] for x in outer_var}
