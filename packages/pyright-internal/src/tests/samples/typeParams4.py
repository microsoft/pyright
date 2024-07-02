# This sample tests errors related to the use of a Generic
# or Protocol base class with PEP 695 type parameter syntax.

from typing import Generic, Protocol


# This should generate an error because Generic should not
# be used with type parameter syntax.
class ClassA[T](Generic[T]): ...


class ClassB[T](Protocol): ...


# This should generate an error because Protocol should not be used
# with type parameters when used with type parameter syntax.
class ClassC[T](Protocol[T]): ...
