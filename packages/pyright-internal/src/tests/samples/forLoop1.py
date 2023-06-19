# This sample tests 'for' operations (both simple for loops
# and list comprehension for loops).

from typing import overload


def requires_int(val: int):
    pass


list1: list[int] = [1, 2, 3]

for a in list1:
    requires_int(a)


int1 = 1

# This should generate an error because
# an int type is not iterable.
for foo1 in int1:
    pass


async def func1():
    # This should generate an error because
    # list1 isn't an async iterator.
    async for foo2 in list1:
        requires_int(foo2)


class AsyncIterable1(object):
    def __aiter__(self):
        return self

    async def __anext__(self):
        return 1


iter1 = AsyncIterable1()


async def func2():
    async for foo3 in iter1:
        requires_int(foo3)

    for d in [b for b in list1]:
        requires_int(d)

    for e in [b async for b in iter1]:
        requires_int(e)


class ClassWithGetItem(object):
    def __getitem__(self, item) -> str:
        return "hello"


def testGetItemIterator() -> str:
    objWithGetItem = ClassWithGetItem()
    for f in objWithGetItem:
        return f
    return "none"

# This should generate a syntax error.
for in range(3):
    pass


class A:
    def __init__(self):
        self.__iter__ = lambda: iter([])


# This should generate an error because A
# is not iterable. The __iter__ method is an
# instance variable.
for a in A():
    ...

class B:
    __slots__ = ("__iter__",)
    def __init__(self):
        self.__iter__ = lambda: iter([])


for b in B():
    ...

def func3():
    x = None
    for x in range(1):
        pass

    reveal_type(x, expected_text="int | None")


class C:
    @overload
    def __getitem__(self, i: int) -> str:
        ...

    @overload
    def __getitem__(self, i: slice) -> list[str]:
        ...

    def __getitem__(self, i: int | slice) -> str | list[str]:
        ...


c = C()

for c1 in iter(c):
    reveal_type(c1, expected_text="str")

for c2 in c:
    reveal_type(c2, expected_text="str")

