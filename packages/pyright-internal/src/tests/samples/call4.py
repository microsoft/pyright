# This sample tests that the TypeVar matching logic for
# functions is working correctly.

a: list[str] = ["a", "bc"]

# This should work because the "sorted" is defined
# with the first parameter of Iterable[_T] and the
# 'key' parameter Callable[[_T], Any]. Since "len"
# is a function that takes a "Sized" and "str" is
# a "Sized", the result of this should be List[str].
b: list[str] = sorted(a, key=len)
