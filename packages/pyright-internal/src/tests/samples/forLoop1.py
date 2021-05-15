# This sample tests 'for' operations (both simple for loops
# and list comprehension for loops).

from typing import AsyncIterator, List, Iterator


def requires_int(val: int):
    pass


list1 = [1, 2, 3]  # type: List[int]

for a in list1:
    requires_int(a)


int1 = 1

# This should generate an error because
# an int type is not iterable.
for foo1 in int1:
    pass


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
