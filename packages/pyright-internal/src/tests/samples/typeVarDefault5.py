# This sample tests the handling of TypeVar defaults in classes
# with a constructor that defines an __init__ but no __new__.

from dataclasses import dataclass

class ClassA: ...

@dataclass
class ClassB[T: ClassA = ClassA]:
    owner: T

def post_comment[T: ClassA](owner: T) -> ClassB[T]:
    return ClassB(owner)

