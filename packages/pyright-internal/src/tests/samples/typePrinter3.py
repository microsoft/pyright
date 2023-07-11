class A:
    class Child1:
        pass


class B:
    class Child1:
        pass

    class Child2:
        pass


# This should generate an error that uses fully-qualified names.
v1: A.Child1 = B.Child1()

# This should generate an error that uses simple names.
v2: A.Child1 = B.Child2()
