# This sample tests the logic that determines whether
# an unannotated decorator should allow the decorated
# function type (and docstring) to pass through unmodified.


def simple_decorator(method):
    def wrapper(*args, **kw):
        result = method(*args, **kw)
        return result

    return wrapper


@simple_decorator
def function(var: str, kvar: str):
    return


reveal_type(function, expected_text="(var: str, kvar: str) -> None")


class Foo:
    @simple_decorator
    def method(self, var: str, kvar: str):
        return


reveal_type(Foo().method, expected_text="(var: str, kvar: str) -> None")
reveal_type(Foo.method, expected_text="(self: Foo, var: str, kvar: str) -> None")
