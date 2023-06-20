# This sample tests the type checker's ability to determine which
# symbols are potentially unbound.

if True:

    class X:
        # This should generate an error because 'X' is not yet declared.
        def func1(self) -> X:
            return X()

    a: X

    class A:
        a: X
        b = X

        def fn(self) -> X:
            return X()
