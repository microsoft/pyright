# This sample tests type checking for list comprehensions.

from typing import Any, Generator, List

a = [1, 2, 3, 4]

def func1() -> Generator[int]:
    b = (elem for elem in a)
    return b


def func2() -> List[str]:
    c = [elem for elem in a]
    return c

def generate():
  for i in range(2):
    yield i

s = generate()
s.close()   # valid python code,  but pyright reports "Cannot access member close on type 'Iterator[int]'

