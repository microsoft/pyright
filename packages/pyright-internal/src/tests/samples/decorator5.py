# This sample tests the logic that determines whether
# an unannotated decorator should allow the decorated
# function type (and docstring) to pass through unmodified.


def decorator1(method):
    def wrapper(*args, **kw):
        result = method(*args, **kw)
        return result

    return wrapper


@decorator1
def func1(var: str, kvar: str):
    return


reveal_type(func1, expected_text="(var: str, kvar: str) -> None")


class ClassA:
    @decorator1
    def method1(self, var: str, kvar: str):
        return


reveal_type(ClassA().method1, expected_text="(var: str, kvar: str) -> None")
reveal_type(ClassA.method1, expected_text="(self: ClassA, var: str, kvar: str) -> None")
