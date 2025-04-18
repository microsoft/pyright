# This sample tests various aspects of the Shape refinement type.

# pyright: reportMissingModuleSource=false

from tensorlib import Size, Tensor, cat, conv2d, randn, sum


def func1(x: Size @ "x, y") -> Size @ "x, y":
    return x


def func2(s1: Size @ "1, 2", s2: Size @ "1, 2, x"):
    # This should generate an error.
    func1(s2)

    v1 = func1(s1)
    reveal_type(v1, expected_text='Size @ "1, 2"')

    x1, y1 = s1
    reveal_type(x1, expected_text="int @ 1")
    reveal_type(y1, expected_text="int @ 2")

    # This should generate an error.
    x2, y2, z2 = s1

    x3, *other3 = s2
    reveal_type(x3, expected_text="int @ 1")
    reveal_type(other3, expected_text='list[int @ 2 | int @ "x"]')


def index1(t1: Tensor @ "a, b, c"):
    s1 = t1.shape
    reveal_type(s1, expected_text='Size @ "a, b, c"')

    s2 = s1[2]
    reveal_type(s2, expected_text='int @ "c"')

    s3 = s1[-3]
    reveal_type(s3, expected_text='int @ "a"')

    # This should generate an error.
    s4 = s1[-4]

    # This should generate an error.
    s5 = s1[4]


def index2(t1: Tensor @ "a, b, *other"):
    s1 = t1.shape
    reveal_type(s1, expected_text='Size @ "a, b, *other"')

    s2 = s1[2]
    reveal_type(s2, expected_text='int @ "index((a, b, *other), 2)"')

    s3 = s1[-3]
    reveal_type(s3, expected_text='int @ "index((a, b, *other), -3)"')

    s4 = s1[-4]
    reveal_type(s4, expected_text='int @ "index((a, b, *other), -4)"')

    s5 = s1[4]
    reveal_type(s5, expected_text='int @ "index((a, b, *other), 4)"')


def concat1(t1: Tensor @ "a, b, c", t2: Tensor @ "a, 1, c"):
    s1 = cat((t1, t2), dim=1)
    reveal_type(s1, expected_text='Tensor @ "a, b + 1, c"')

    s2 = cat((t1, t2, t2), dim=1)
    reveal_type(s2, expected_text='Tensor @ "a, b + 2, c"')

    # This should generate an error.
    s3 = cat((t1, t2, t2))

    # This should generate an error.
    s4 = cat((t1, t2, t2), dim=2)

    # This should generate an error.
    s5 = cat((t1, t2, t2), dim=-1)

    # This should generate an error.
    s6 = cat((t1, t2, t2), dim=5)


def conv1(input: Tensor @ "n, c_in, y, x", weight: Tensor @ "c_out, c_in, ky, kx"):
    c1 = conv2d(input, weight)
    reveal_type(c1, expected_text='Tensor @ "n, c_out, y - ky + 1, x - kx + 1"')


def conv2(x: Tensor @ "B, C, H, W", filters: Tensor @ "C, C, F1, F2"):
    return conv2d(x, filters, stride=2)


def conv3():
    filters = randn(4, 4, 5, 5)
    reveal_type(filters, expected_text='Tensor @ "4, 4, 5, 5"')

    c0 = conv2(randn(1, 4, 5, 5), filters)
    reveal_type(c0, expected_text='Tensor @ "1, 4, 1, 1"')

    c1 = conv2(randn(1, 4, 32, 32), filters)
    reveal_type(c1, expected_text='Tensor @ "1, 4, 14, 14"')

    c2 = conv2(randn(1, 4, 53, 32), filters)
    reveal_type(c2, expected_text='Tensor @ "1, 4, 25, 14"')

    c3 = conv2(randn(1, 4, 28, 28), filters)
    reveal_type(c3, expected_text='Tensor @ "1, 4, 12, 12"')


def sum1(t1: Tensor @ "a, b"):
    s1 = sum(t1)
    reveal_type(s1, expected_text='Tensor @ "1,"')

    s2 = sum(t1, dim=0)
    reveal_type(s2, expected_text='Tensor @ "b,"')

    s3 = sum(t1, dim=0, keepdim=True)
    reveal_type(s3, expected_text='Tensor @ "1, b"')

    s4 = sum(t1, dim=1)
    reveal_type(s4, expected_text='Tensor @ "a,"')

    s5 = sum(t1, dim=1, keepdim=True)
    reveal_type(s5, expected_text='Tensor @ "a, 1"')

    s6 = sum(t1, dim=-1)
    reveal_type(s6, expected_text='Tensor @ "a,"')

    s7 = sum(t1, dim=-2)
    reveal_type(s7, expected_text='Tensor @ "b,"')

    # This should generate an error.
    s8 = sum(t1, dim=2)

    # This should generate an error.
    s9 = sum(t1, dim=-3)
