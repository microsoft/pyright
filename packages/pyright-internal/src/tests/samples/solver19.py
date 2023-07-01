# This sample tests the handling of Type[T] matching and replacement.

from typing import Generator, TypeVar


class LI(list[int]):
    pass


class LS(list[str]):
    pass


_T1 = TypeVar("_T1")


class MyList(list[LI | LS]):
    def get_generator(self, *, type_: type[_T1]) -> Generator[_T1, None, None]:
        for elem in self:
            if isinstance(elem, type_):
                yield elem


def same(other: LI | LS):
    for elem in MyList().get_generator(type_=other.__class__):
        for v in elem:
            print(v)
