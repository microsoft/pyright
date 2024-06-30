# This sample tests that instantiation of a protocol is flagged
# as an error.

from typing import Protocol


class A(Protocol): ...


# This should generate an error.
A()


class B(A): ...


B()


class C(A, Protocol): ...


# This should generate an error.
C()
