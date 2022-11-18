# This sample tests the case where an unpacked TypeVarTuple is used
# as one or more type arguments for a tuple.

from typing import Iterable, TypeVar, TypeVarTuple, Union

T = TypeVar("T")
Ts = TypeVarTuple("Ts")

def func1(a: Iterable[T], b: Iterable[T]):
   i = iter(a)
   j = iter(b)
   while True:
      try:
         yield (next(i), next(j))
      except StopIteration:
         break

reveal_type(func1, expected_text="(a: Iterable[T@func1], b: Iterable[T@func1]) -> Generator[tuple[T@func1, T@func1], None, None]")

def func2(a: tuple[*Ts], b: tuple[*Ts]):
   for i in func1(a, b):
      yield i

reveal_type(func2, expected_text="(a: tuple[*Ts@func2], b: tuple[*Ts@func2]) -> Generator[tuple[Union[*Ts@func2], Union[*Ts@func2]], None, None]")

def func3():
   v1 = func2((1, "foo"), (2, "bar"))
   reveal_type(v1, expected_text="Generator[tuple[int | str, int | str], None, None]")

   for i in v1:
      reveal_type(i, expected_text="tuple[int | str, int | str]")


def func5(x: "Iterable[Union[*Ts]]") -> Iterable[Union[*Ts]]:
    ...

def func6():
   v1: list[int]  = [i for i in func5([1, 2, 3])]
   v2: list[int | str] = [i for i in func5([1, "foo"])]
