# This sample tests the PEP 695 type parameter syntax for generic classes
# and functions.

T1 = 0


class ClassA[T1]: ...


def func1[T1](): ...


T2: str


class ClassB[T2]: ...


def func2[T2](): ...


# This should generate an error because T3 is duplicated.
class ClassC[T3, S1, T3]: ...


class ClassD:
    class ClassE: ...

    class ClassF:
        class A[T]: ...

        int_alias = int

        class B(A[int_alias]):
            pass

        # This should generate an error because ClassE is out of scope.
        class C(A[ClassE]):
            pass


class ClassG[T](list["T"]):
    pass


class ClassH:
    def object[T](self, target: object, new: T) -> T: ...


# This should generate an error because T3 is duplicated.
def func3[T3, S1, T3](): ...


def func4[T4](T4: int): ...


def func5[T5](a: int):
    # This should generate an error because T5 is already in use.
    class ClassA[T5]: ...

    # This should generate an error because T5 is already in use.
    def inner_func1[T5](): ...


def func6[T6](T7: int):
    class ClassA[T7]: ...

    def inner_func1[T7](): ...

    global T2

    class ClassB[T2]:
        global T2

    class ClassC[T3]:
        T3 = 4

    T3 = 4


def func7[T8: ForwardRefClass[str], T9: "ForwardRefClass[int]"]():
    pass


def func8[T10: (ForwardRefClass[str], "ForwardRefClass[int]")]():
    pass


class ForwardRefClass[T]:
    pass


class ClassI1: ...


class ClassI2:
    def method1[T](self, v: ClassI1) -> None: ...

    # This should generate an error because ClassJ is
    def method2[T](self, v: ClassI3) -> None: ...


class ClassI3: ...


def func9[T, **P, S](x: T) -> T:
    S = 1

    def inner():
        # This should generate two errors.
        nonlocal T, P

        nonlocal S

    return x
