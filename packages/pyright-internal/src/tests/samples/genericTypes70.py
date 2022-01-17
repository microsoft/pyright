# This sample tests the case where a generic class has a constructor that
# supplies the type arguments via a callable which is itself generic.


from typing import Callable, Generic, Sequence, TypeVar

T = TypeVar("T")
V = TypeVar("V", bound=object)
V_co = TypeVar("V_co", covariant=True)
U = TypeVar("U", bound=object)


class Result(Generic[V]):
    pass


ParseFn = Callable[[Sequence[T], int, int], Result[V]]


class Parser(Generic[T, V_co]):
    def fmap1(self, fn: Callable[[V_co], U]) -> "Parser[T, U]":
        def fmap2(stream: Sequence[T], pos: int, bt: int) -> Result[U]:
            raise NotImplementedError()

        reveal_type(FnParser(fmap2), expected_text="FnParser[T@Parser, U@fmap1]")
        return FnParser(fmap2)


class FnParser(Parser[T, V_co]):
    def __init__(self, fn: ParseFn[T, V_co]):
        self._fn = fn
