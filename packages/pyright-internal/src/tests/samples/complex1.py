# This sample tests the type checker's handling of imaginary
# and complex numbers.

a = 3.2j

b = a + 4

c = 1.2 * a


def requires_complex(val: complex): ...


requires_complex(a)
requires_complex(b)
requires_complex(c)
