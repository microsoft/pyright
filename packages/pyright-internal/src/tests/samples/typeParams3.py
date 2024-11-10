# This sample tests error conditions related to the use of PEP 695
# type parameters outside of their valid scope.


class ClassA[S]:
    s: S

    class ClassB[T](dict[S, T]):
        s: S
        t: T

        def method1[U](self):
            s: S
            t: T
            u: U
            lambda: (S, T, U)

    # This should generate an error because T is out of scope.
    t: T


# This should generate an error because S is out of scope.
s: S

# This should generate an error because T is out of scope.
t: T


def func1[A]():
    def func2[B]():
        a: A
        b: B

        class ClassC[C](dict[B, C]):
            a: A
            b: B
            c: C

            def method1[D](self):
                a: A
                b: B
                c: C
                d: D
                e = lambda: (A, B, C, D)

    a: A

    # This should generate an error because B is out of scope.
    b: B


# This should generate an error because A is out of scope.
a: A

# This should generate an error because B is out of scope.
b: B

type TA1[A] = list[A]

# This should generate an error because B is out of scope.
type TA2[A] = list[B]


S = 0


def outer1[S]():
    S = ""
    T = 1

    def outer2[T]():
        def inner1():
            nonlocal S  # OK
            reveal_type(S, expected_text="Literal['']")

        def inner2():
            global S  # OK
            reveal_type(S, expected_text="Literal[0]")


T = 0


class Outer2[T]:
    T = 1

    reveal_type(T, expected_text="Literal[1]")

    class Inner1:
        T = ""

        reveal_type(T, expected_text="Literal['']")

        def inner_method(self):
            reveal_type(T, expected_text="TypeVar")

    def outer_method(self):
        T = 3j

        reveal_type(T, expected_text="complex")

        def inner_func():
            reveal_type(T, expected_text="complex")


class Outer3[T]:
    # This should generate an error because Outer3 is
    # not bound at this point.
    def inner_func1[S](self: Outer3[S]): ...
