# This sample tests the type checker's ability to 
# perform TypeVar matching in the case where the first
# encounter with the TypeVar is contravariant but later
# encounters are covariant or invariant.

def foo(value: object) -> bool:
    ...

# This should evaluate to a type of "Iterable[str]",
# not "Iterable[object]".
filtered_list = filter(foo, ['b', 'a', 'r'])
should_be_str = next(filtered_list)
a = len(should_be_str)

