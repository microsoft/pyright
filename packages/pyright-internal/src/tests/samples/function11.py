# This sample tests the ability of the type checker to
# deal with circular references in return types.


class Foo1:
    # This should generate an error because 'dict' is
    # a forward reference, so it refers to the function
    # itself.
    def dict(self) -> "dict":
        # This should generate an error because the return
        # type doesn't match.
        return {}


class Foo2:
    def dict(self) -> dict:
        return {}
