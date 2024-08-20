# This sample tests the "Shape" refinement type.

# pyright: reportMissingModuleSource=false

from typing_extensions import Shape


class Tensor: ...


def matmul(a: Tensor @ Shape("x, y"), b: Tensor @ Shape("y, z")) -> Tensor @ Shape(
    "x, z"
): ...


def func1(
    a: Tensor @ Shape("a, b"), b: Tensor @ Shape("b, c"), c: Tensor @ Shape("b, b")
):
    v1 = matmul(a, b)
    reveal_type(v1, expected_text='Tensor @ Shape("a, c")')

    v2 = matmul(a, c)
    reveal_type(v2, expected_text='Tensor @ Shape("a, b")')

    v3 = matmul(c, c)
    reveal_type(v3, expected_text='Tensor @ Shape("b, b")')

    v4 = matmul(c, b)
    reveal_type(v4, expected_text='Tensor @ Shape("b, c")')

    # This should generate an error.
    matmul(c, a)

    # This should generate an error.
    matmul(b, a)


class Size(tuple[int, ...]): ...


def func2(v: Size @ Shape("x, y, z")):
    a, b, c = v
    reveal_type(a, expected_text='int @ "x"')
    reveal_type(b, expected_text='int @ "y"')
    reveal_type(c, expected_text='int @ "z"')

    d, *x = v
    reveal_type(d, expected_text='int @ "x"')
    reveal_type(x, expected_text='list[int @ "y" | int @ "z"]')

    k, j, *m, n = v
    reveal_type(k, expected_text='int @ "x"')
    reveal_type(j, expected_text='int @ "y"')
    reveal_type(m, expected_text="list[Never]")
    reveal_type(n, expected_text='int @ "z"')
