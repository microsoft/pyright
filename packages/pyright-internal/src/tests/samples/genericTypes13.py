# This sample tests the type checker's ability to do bidirectional
# type inference when the expected type is defined by a bound TypeVar.

from typing import Dict, TypeVar

class A:
  pass
class B(A):
  pass
class C(A):
  pass

_T_A = TypeVar('_T_A', bound=A)

def testFunc(value: Dict[str, _T_A]):
  pass

testFunc({
  "b": B(),
  "c": C()
})

