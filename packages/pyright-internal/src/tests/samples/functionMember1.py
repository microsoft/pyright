# This sample tests the reportFunctionMemberAccess diagnostic rule.

from inspect import Signature
from types import FunctionType
from typing import cast


def func1():
    pass


a = func1.__annotations__
b = func1.__class__

# These function metadata attributes can be assigned at runtime.
func1.__signature__ = Signature()
func1.__text_signature__ = "()"


def set_signature(func: FunctionType) -> None:
    func.__signature__ = Signature()
    func.__text_signature__ = "()"


# Functions implemented in Python remain writable even if they are declared in a core stdlib stub.
cast.__signature__ = Signature()

# This should generate an error because reads remain unknown.
d = func1.__signature__

# This should generate an error because deletes remain unknown.
del func1.__text_signature__


# This should generate an error because builtin functions don't allow attribute assignments.
len.__signature__ = Signature()

# This should generate an error because overloaded builtin functions don't allow attribute assignments.
open.__text_signature__ = "()"

# This should generate an error
c = func1.bar

# This should generate an error
func1.baz = 3

# This should generate an error
del func1.baz
