# This sample tests TypeVar matching when there are multiple sources
# and some of them are Unknown. The TypeVar constraint solver contains
# special heuristics to deal with this case.


def func1(u):
    b: bool = True

    x = dict(b=b, u=u, x=[])
    reveal_type(x, expected_text="dict[str, bool | list[Any]]")
