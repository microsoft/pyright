# This sample tests that positional arg expressions are evaluated prior
# to keyword arg expressions even if they don't appear in that order
# within the arg list.


from typing import TypedDict


def func1(a: int | None = None, b: int | None = None, c: int | None = None) -> None:
    pass


func1((v1 := 1), b=v1 + 1)

# This should generate an error.
func1(b=(v2 := 1), *[v2 + 1])

func1(b=v3 + 1, *[(v3 := 1)])


class A(TypedDict):
    a: int


class B(TypedDict):
    b: int


class C(TypedDict):
    c: int


func1(a=(v4 := 1), **B(b=(v4 + 1)))

# This should generate an error.
func1(**A(a=(v5 + 1)), b=(v5 := 1))

func1(**A(a=(v5 := 1)), b=(v5 + 1))

func1(b=(v6 + 1), *[(v6 := 1)], **C(c=(v6 + 2)))


def func2(a: int, b: int):
    pass


func2(b=1, *(2,))
