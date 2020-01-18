# This sample tests that a Generic base class overrides the type parameter
# ordering of other type parameters.

from typing import Generic, Iterable, TypeVar

_T1 = TypeVar('_T1')
_T2 = TypeVar('_T2', 'str') # 'str' should be treated as forward reference

class Foo(Iterable[_T2], Generic[_T1, _T2]):
    def __init__(self, a: _T1, b: _T2):
        pass

    def foo(self, a: _T1, b: _T2) -> _T2:
        return b

a: Foo[int, str] = Foo(2, '')
b: str = a.foo(4, '')

# This should generate an error because a class shouldn't
# derive from Generic more than once.
class Bar(Generic[_T1], Generic[_T2]):
    pass


