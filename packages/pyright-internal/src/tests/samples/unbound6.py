# This sample tests the case where a variable in an outer scope is captured
# by inner scopes and is potentially unbound.


def func1():
    if 1 + 1 > 3:
        y = 0

    class A:
        def method1(self):
            # This should generate a "possibly unbound" error.
            print(y)

            def inner():
                # This should generate a "possibly unbound" error.
                print(y)

            # This should generate a "possibly unbound" error.
            v = lambda: y

            # This should generate a "possibly unbound" error.
            x = [m + y for m in range(3)]

    def func1(self):
        # This should generate a "possibly unbound" error.
        print(y)

        def inner():
            # This should generate a "possibly unbound" error.
            print(y)

        # This should generate a "possibly unbound" error.
        v = lambda: y

        # This should generate a "possibly unbound" error.
        x = [m + y for m in range(3)]

    # The code below should not generate any errors because
    # z is assigned a value later.
    if 1 + 1 > 3:
        z = 0

    class B:
        def method1(self):
            print(z)

            def inner():
                print(z)

            v = lambda: z

            x = [m + z for m in range(3)]

    def func2(self):
        print(z)

        def inner():
            print(z)

        v = lambda: z

        x = [m + z for m in range(3)]

    z = 0
