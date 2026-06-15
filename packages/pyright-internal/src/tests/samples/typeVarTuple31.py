# This sample tests the case where a TypeVarTuple is used in a method
# called on an instance whose type arguments contain deeply nested
# recursive tuple type aliases. The deep nesting previously caused the
# solved TypeVar to "escape" because type var transformation bailed out
# early on deeply nested tuples.

from typing import final, override
from collections.abc import Callable


@final
class Ok[T]:
    __match_args__ = ("_value",)

    def __init__(self, value: T):
        self._value: T = value


@final
class Err[E]:
    def __init__(self, value: E):
        self._value: E = value


type Result[T, E] = Ok[T] | Err[E]

type ParserResult[O, E] = Result[tuple[int, O], E]
type ParserFunc[O, E] = Callable[[str, int], ParserResult[O, E]]


class Parser[O, E]:
    def __init__(self, func: ParserFunc[O, E]):
        self._func: ParserFunc[O, E] = func

    def then[OO, OE](self, _other: "Parser[OO, OE]") -> "Parser[tuple[O, OO], E | OE]":
        raise NotImplementedError

    def unpack_then[*TS, OO, OE](
        self: "Parser[tuple[*TS], E]", _other: "Parser[OO, OE]"
    ) -> "Parser[tuple[*TS, OO], E | OE]":
        raise NotImplementedError


def produce[T](_: T | None = None) -> T:
    raise NotImplementedError


class ForwardRefParser[O, E](Parser[O, E]):
    @override
    def __init__(self, func: Callable[[], Parser[O, E]]):
        self._meta_func: Callable[[], Parser[O, E]] = func
        super().__init__(produce())


type Whitespace = tuple[tuple[tuple[tuple[Whitespace]]]]
type Implementations = tuple[tuple[tuple[Whitespace], Implementations]]
type BlockItem = tuple[tuple[Implementations]] | tuple[BlockItem]

ws: ForwardRefParser[Whitespace, None] = produce()
implementations: ForwardRefParser[Implementations, None] = produce()
block: Parser[tuple[BlockItem], None] = produce()

# This should not generate an error. Previously the "OO" TypeVar from
# "unpack_then" escaped into the inferred type of this assignment.
forloop: ForwardRefParser[
    tuple[
        Whitespace,
        Whitespace,
        tuple[BlockItem],
        Whitespace,
    ],
    None,
] = ForwardRefParser(lambda: ws.then(ws).unpack_then(block).unpack_then(ws))
