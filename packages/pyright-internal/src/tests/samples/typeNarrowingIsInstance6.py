# This sample tests the case where an isinstance call uses
# a union of class types, some of which are tuples of other types
# and some of which are not.

from typing import Tuple, Type, TypeVar, Iterator, Union

T1 = TypeVar("T1", bound="X")
T2 = TypeVar("T2", bound="X")


class X:
    element_list: list["X"]

    def return_iter(
        self, cls: Union[Type[T1], Tuple[Type[T1], Type[T2]]]
    ) -> Union[Iterator[T1], Iterator[T2]]:
        for item in self.element_list:
            if isinstance(item, cls):
                yield item
