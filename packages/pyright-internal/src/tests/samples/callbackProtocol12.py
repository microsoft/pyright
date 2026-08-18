# This sample tests that a callable with *args/**kwargs is not assignable
# to a callable whose positional-or-keyword parameter cannot be passed
# by keyword to the source (typing spec callable assignability).

from typing import Protocol


class AcceptsArgsKwargs(Protocol):
    def __call__(self, *args: int, **kwargs: bool) -> None: ...


class AcceptsKeywordOrPositional(Protocol):
    def __call__(self, a: int) -> None: ...


def func1(cb: AcceptsArgsKwargs):
    # This should generate an error because AcceptsKeywordOrPositional
    # can be called as cb(a=10), which is not valid for **kwargs: bool.
    x: AcceptsKeywordOrPositional = cb


class AcceptsKeywordOnly(Protocol):
    def __call__(self, *args: int, a: bool = False) -> None: ...


def func2(cb: AcceptsKeywordOnly):
    # This should generate an error because the keyword form of
    # parameter "a" has type int on the dest and bool on the source.
    y: AcceptsKeywordOrPositional = cb


def ok_cb(a: int) -> None:
    pass


def func3(cb: AcceptsKeywordOrPositional):
    z: AcceptsKeywordOrPositional = ok_cb
