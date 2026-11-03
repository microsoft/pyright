from _typeshed import Incomplete
from collections.abc import Iterable
from typing import overload

from networkx.classes.graph import Graph
from networkx.utils.backends import _dispatchable
from networkx.utils.misc import _RandomState

from ..classes.digraph import DiGraph

__all__ = [
    "prefix_tree",
    "prefix_tree_recursive",
    "random_labeled_tree",
    "random_labeled_rooted_tree",
    "random_labeled_rooted_forest",
    "random_unlabeled_tree",
    "random_unlabeled_rooted_tree",
    "random_unlabeled_rooted_forest",
]

@_dispatchable
def prefix_tree(paths: Iterable[Incomplete]) -> DiGraph[Incomplete]: ...
@_dispatchable
def prefix_tree_recursive(paths: Iterable[Incomplete]) -> DiGraph[Incomplete]: ...
@_dispatchable
def random_labeled_tree(n: int, *, seed: _RandomState = None) -> Graph[int]: ...
@_dispatchable
def random_labeled_rooted_tree(n: int, *, seed: _RandomState = None) -> Graph[int]: ...

@overload
def random_unlabeled_rooted_tree(
    n: int,
    *,
    number_of_trees: None = None,
    seed: _RandomState = None,
    backend=None,  # @_dispatchable adds these arguments, but we can't use this decorator with @overload
    **backend_kwargs,
) -> Graph[int]: ...
@overload
def random_unlabeled_rooted_tree(
    n: int, *, number_of_trees: int, seed: _RandomState = None, backend=None, **backend_kwargs
) -> list[Graph[int]]: ...

@_dispatchable
def random_labeled_rooted_forest(n: int, *, seed: _RandomState = None) -> Graph[int]: ...

@overload
def random_unlabeled_rooted_forest(
    n: int, *, q: int | None = None, number_of_forests: None = None, seed: _RandomState = None, backend=None, **backend_kwargs
) -> Graph[int]: ...
@overload
def random_unlabeled_rooted_forest(
    n: int, *, q: int | None = None, number_of_forests: int, seed: _RandomState = None, backend=None, **backend_kwargs
) -> list[Graph[int]]: ...

@overload
def random_unlabeled_tree(
    n: int, *, number_of_trees: None = None, seed: _RandomState = None, backend=None, **backend_kwargs
) -> Graph[int]: ...
@overload
def random_unlabeled_tree(
    n: int, *, number_of_trees: int, seed: _RandomState = None, backend=None, **backend_kwargs
) -> list[Graph[int]]: ...
