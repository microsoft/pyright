# This sample tests the case where a recursive type alias previous
# led to infinite recursion.

from typing import Iterable, TypeVar, Union

T = TypeVar("T")
Tree = list[Union["Tree[T]", T]]


def _flatten(tree: Union[Tree[T], T]) -> Iterable[T]:
    if not isinstance(tree, list):
        yield tree
        return
    for v in tree:
        yield from _flatten(v)


def flatten(tree: Tree[T]) -> Iterable[T]:
    return _flatten(tree)


flatten([1, [2, 3]])
