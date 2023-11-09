# This sample verifies that a subclass of a class that supports
# __init_subclass__ provides the required initialization parameters.


class A:
    def __init_subclass__(cls, param_a: int):
        super().__init_subclass__()


class B(A, param_a=123):
    pass


# This should generate two errors because param_a is missing.
class C(B):
    pass
