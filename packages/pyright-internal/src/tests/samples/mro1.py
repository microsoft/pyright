# This sample tests the type checker's ability to
# detect a bad MRO.


class A:
    pass


class B(A):
    pass


# This should generate an error because a valid
# MRO linearization isn't possible.
class C(A, B):
    pass
