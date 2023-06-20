# This sample tests the type checker's handling of
# empty tuples and assignment to empty tuples.

a: tuple[()] = ()

# This should generate an error because the assigned
# tuple has one element, but the destination is
# expecting zero.
b: tuple[()] = (1,)

# This should generate an error because the assigned
# tuple has zero elements, but the destination is
# expecting two.
c: tuple[int, str] = ()
