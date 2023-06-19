# This sample tests the reportIncompatibleVariableOverride
# configuration option in cases involving multiple inheritance
# where the override symbol is type compatible with the overridden.


# pyright: reportIncompatibleVariableOverride=true


class A:
    class M:
        pass


class B0(A):
    class M(A.M):
        pass


class B1(A):
    class M(A.M):
        pass


class C(B0, B1):
    class M(B0.M, B1.M):
        pass


class D0(B0):
    pass


class D1(B1):
    pass


class D(D0, D1, C):
    pass


class E0(B0):
    pass


class E1(B1):
    pass


# This should generate an error because B0.M is not
# type compatible with B1.M.
class E(E0, E1):
    pass
