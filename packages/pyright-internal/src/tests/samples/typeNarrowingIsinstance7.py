# This sample tests the case where an isinstance call uses
# a union of class types, some of which are tuples of other types
# and some of which are not.

from typing import TypeVar, Iterator

T1 = TypeVar("T1", bound="X")
T2 = TypeVar("T2", bound="X")


class X:
    element_list: list["X"]

    def return_iter(
        self, cls: type[T1] | tuple[type[T1], type[T2]]
    ) -> Iterator[T1 | T2]:
        for item in self.element_list:
            if isinstance(item, cls):
                yield item
