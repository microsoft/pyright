# This sample tests error detection for certain cases that
# are explicitly disallowed by PEP 572 for assignment expressions
# when used in context of a list comprehension.

pairs = []
stuff = []

# These should generate an error because assignment
# expressions aren't allowed within an iterator expression
# in a "for" clause of a list comprehension.
[x for x, y in (pairs2 := pairs) if x % 2 == 0]
[x for x, y in ([1, 2, 3, pairs2 := pairs]) if x % 2 == 0]
{x: y for x, y in (pairs2 := pairs) if x % 2 == 0}
{x for x, y in (pairs2 := pairs) if x % 2 == 0}
foo = (x for x, y in ([1, 2, 3, pairs2 := pairs]) if x % 2 == 0)

# This should generate an error because 'j' is used as a
# "for target" and the target of an assignment expression.
[[(j := j) for i in range(5)] for j in range(5)]
[i := 0 for i, j in stuff]
[i + 1 for i in (i := stuff)]

[False and (i := 0) for i, j in stuff]
[i for i, j in stuff if True or (j := 1)]

# These should generate an error because assignment
# expressions aren't allowed within an iterator expression
# in a "for" clause of a list comprehension.
[i + 1 for i in (j := stuff)]
[i + 1 for i in range(2) for j in (k := stuff)]
[i + 1 for i in [j for j in (k := stuff)]]
[i + 1 for i in (lambda: (j := stuff))()]


class Example:
    # This should generate an error because the containing
    # scope for the list comprehension is a class.
    [(j := i) for i in range(5)]

    x = ((y := 1), (z := 2))


Example.x
Example.y
Example.z

# This should generate an error because 'j' is used as a
# "for target" and the target of an assignment expression.
[i for i in [1, 2] if True or (j := 1) for j in range(10)]
