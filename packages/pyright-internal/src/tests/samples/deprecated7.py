# This sample tests the case where a "deprecated" instance is instantiated
# prior to being used as a decorator.

# pyright: reportMissingModuleSource=false

from typing_extensions import deprecated


todo = deprecated("This needs to be implemented!!")


@todo
class ClassA: ...


# This should generate an error if reportDeprecated is enabled.
ClassA()


@todo
def func1() -> None:
    pass


# This should generate an error if reportDeprecated is enabled.
func1()


def func2() -> None:
    pass
