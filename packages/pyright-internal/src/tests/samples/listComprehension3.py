# This sample tests type inference for list comprehensions,
# including list target expressions in for statements.


def foo() -> list[str]:
    pairs = [s.split(":") if ":" in s else [s, "null"] for s in ["foo:bar", "baz"]]
    foo = [p[0] for p in pairs]
    if foo:
        return foo

    bar = [a for [a, b] in pairs]
    return bar
