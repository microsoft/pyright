# This sample tests that unquoted forward references in annotations report an
# undefined-variable error consistently across Python versions.


# This should generate an error because Bar is not defined yet.
def foo(x: Bar):
    ...


class Bar:
    pass
