# This sample tests various aspects of the "Shape" refinement type.

# pyright: reportMissingModuleSource=false

from tensorlib import Tensor, linspace, randn, index_select, permute, squeeze, unsqueeze


def broadcast1(
    t1: Tensor @ "a, b",
    t2: Tensor @ "x, a, b",
    t3: Tensor @ "x, 1, 1",
    t4: Tensor @ "1, a, c if c == b",
    t5: Tensor @ "1, a, d",
    t6: Tensor @ "3, 1, 4",
    t7: Tensor @ "5, 1, 5, 1",
):
    d1 = t1.sub(t2)
    reveal_type(d1, expected_text='Tensor @ "x, a, b"')

    d2 = t1 - t2
    reveal_type(d2, expected_text='Tensor @ "x, a, b"')

    d3 = t2 + t3
    reveal_type(d3, expected_text='Tensor @ "x, a, b"')

    d3 = t2 - t3
    reveal_type(d3, expected_text='Tensor @ "x, a, b"')

    d4 = t2 + t4
    reveal_type(d4, expected_text='Tensor @ "x, a, b"')

    # This should generate an error.
    d5 = t2 - t5

    d6 = t6 + t7
    reveal_type(d6, expected_text='Tensor @ "5, 3, 5, 4"')


def linspace1(i1: int @ "a if a > 0"):
    t1 = linspace(0, 10, 4)
    reveal_type(t1, expected_text='Tensor @ "4,"')

    t2 = linspace(0, 4, i1)
    reveal_type(t2, expected_text='Tensor @ "a,"')

    t3_out = randn(2)
    reveal_type(t3_out, expected_text='Tensor @ "2,"')
    t3 = linspace(0, 4, 2, out=t3_out)
    reveal_type(t3, expected_text='Tensor @ "2,"')

    # This should generate an error.
    t4 = linspace(0, 4, 3, out=t3_out)

    # This should generate an error.
    t5 = linspace(0, 4, 0)


def index_select1(i: Tensor @ "a, b", x: Tensor @ "3, "):
    t1 = index_select(i, 0, x)
    reveal_type(t1, expected_text='Tensor @ "3, b"')

    t2 = index_select(i, 1, x)
    reveal_type(t2, expected_text='Tensor @ "a, 3"')

    # This should generate an error.
    t3 = index_select(i, 2, x)


def permute1(t1: Tensor @ "a, b, c"):
    p1 = permute(t1, (1, 2, 0))
    reveal_type(p1, expected_text='Tensor @ "b, c, a"')

    p2 = permute(t1, (0, 2, 1))
    reveal_type(p2, expected_text='Tensor @ "a, c, b"')

    # This should generate an error.
    p3 = permute(t1, (0, 2, 0))

    # This should generate an error.
    p4 = permute(t1, (0, 2, 4))

    # This should generate an error.
    p5 = permute(t1, (0, 1, 2, 3))


def squeeze1(t1: Tensor @ "a, b, 1, 2"):
    s1 = squeeze(t1, 2)
    reveal_type(s1, expected_text='Tensor @ "a, b, 2"')

    s2 = squeeze(t1, -2)
    reveal_type(s1, expected_text='Tensor @ "a, b, 2"')

    s3 = squeeze(t1, -1)
    reveal_type(s3, expected_text='Tensor @ "a, b, 1, 2"')

    # This should generate two errors.
    s4 = squeeze(t1, 5)

    s5 = squeeze(t1, 1)
    reveal_type(s5, expected_text='Tensor @ "a, b, 1, 2"')


def squeeze2(t1: Tensor @ "a, b, 1, 2"):
    s1 = squeeze(t1, (1, 2))
    reveal_type(s1, expected_text="Tensor")


def unsqueeze1(t1: Tensor @ "a, b, c"):
    u1 = unsqueeze(t1, 1)
    reveal_type(u1, expected_text='Tensor @ "a, 1, b, c"')

    u2 = unsqueeze(t1, 3)
    reveal_type(u2, expected_text='Tensor @ "a, b, c, 1"')

    u3 = unsqueeze(t1, -1)
    reveal_type(u3, expected_text='Tensor @ "a, b, c, 1"')

    u4 = unsqueeze(t1, -2)
    reveal_type(u4, expected_text='Tensor @ "a, b, 1, c"')
