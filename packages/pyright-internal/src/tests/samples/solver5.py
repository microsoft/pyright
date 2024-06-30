# This sample tests constraint solving where the first
# encounter with the TypeVar is contravariant but later
# encounters are covariant or invariant.


def func1(value: object) -> bool: ...


v1 = filter(func1, ["b", "a", "r"])
reveal_type(v1, expected_text="filter[str]")

v2 = next(v1)
reveal_type(v2, expected_text="str")
