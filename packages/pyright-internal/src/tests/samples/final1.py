# This sample tests the handling of the @final class decorator.

from typing import final


@final
class ClassA:
    pass


# This should generate an error because ClassA is
# decorated as final.
class ClassB(ClassA):
    pass
