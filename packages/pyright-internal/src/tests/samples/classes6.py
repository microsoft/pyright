# This sample tests proper scopes for nested classes.


class A:
    a = 5

    class B:
        # This should generate an error
        b = a

        class C:
            # This should generate an error
            c = a

            # This should generate an error
            d = b
