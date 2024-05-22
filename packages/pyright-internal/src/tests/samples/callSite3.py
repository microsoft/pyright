# This sample tests the case where a call-site return type evaluation
# is invoked multiple times within a loop using different literal values
# each time.


def func1(h, ids):
    for _ in ids:
        h = func2(h, 1)
        h = func2(h, 2)
        h = func2(h, 3)
        h = func2(h, 4)
        h = func2(h, 5)
        h = func2(h, 6)
        h = func2(h, 7)
        h = func2(h, 8)
        h = func2(h, 9)
        h = func2(h, 10)
        h = func2(h, 11)
        h = func2(h, 12)
        h = func2(h, 13)
        h = func2(h, 14)
        h = func2(h, 15)
        h = func2(h, 16)
        h = func2(h, 17)
        h = func2(h, 18)
        h = func2(h, 19)
        h = func2(h, 20)
        h = func2(h, 21)
        h = func2(h, 22)
        h = func2(h, 23)
        h = func2(h, 24)
        h = func2(h, 25)
        h = func2(h, 26)
        h = func2(h, 27)
        h = func2(h, 28)
        h = func2(h, 29)
        h = func2(h, 30)
        h = func2(h, 31)
        h = func2(h, 32)
        h = func2(h, 33)
        h = func2(h, 34)
        h = func2(h, 35)
        h = func2(h, 36)
        h = func2(h, 37)
        h = func2(h, 38)
        h = func2(h, 39)


def func2(a, unused):
    return a
