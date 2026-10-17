# This sample tests expression restrictions for deferred annotations in Python 3.14.
from typing import Annotated

# scope error
module_value: Annotated[int, (module_meta := 1)] = 0

# Parentheses are optional within a subscript in Python 3.10 and newer.
# scope error
unparenthesized_metadata: Annotated[int, bare_meta := 1] = 0


# scope error
def parameter(value: Annotated[int, (parameter_meta := 1)]):
    pass


# scope error
def result() -> Annotated[int, (return_meta := 1)]:
    return 0


class Container:
    # scope error
    value: Annotated[int, (class_meta := 1)] = 0


def local_annotation():
    # scope error
    value: Annotated[int, (local_meta := 1)] = 0


# A lambda's default is evaluated outside its own scope.
# scope error
lambda_default: Annotated[int, lambda arg=(default_meta := 1): arg] = 0

# scope error
formatted_metadata: Annotated[int, f"{(formatted_meta := 1)}"] = 0


async def metadata() -> int:
    return 1


async def sequence() -> tuple[int, ...]:
    return (1, 2)


async def async_context():
    # scope error
    def inner(value: Annotated[int, await metadata()]):
        pass

    # scope error
    value: Annotated[int, await metadata()] = 0

    # The first iterable is evaluated outside the comprehension's scope.
    # scope error
    generator: Annotated[int, (item for item in await sequence())] = 0


def yield_context():
    # scope error
    def inner(value: Annotated[int, (yield 1)]):
        pass


def yield_from_context():
    # scope error
    def inner(value: Annotated[int, (yield from (1, 2))]):
        pass


# Nested lambda and comprehension bodies have their own scopes.
lambda_body: Annotated[int, lambda: (lambda_meta := 1)] = 0
lambda_yield: Annotated[int, lambda: (yield 1)] = 0
comprehension_body: Annotated[int, [(list_meta := item) for item in (1, 2)]] = 0
generator_body: Annotated[int, ((generator_meta := item) for item in (1, 2))] = 0
generator_await: Annotated[int, (await metadata() for item in (1, 2))] = 0

# A regular assignment does not introduce an annotation scope.
OrdinaryAlias = Annotated[int, (assignment_meta := 1)]

# Expressions parsed from strings or type comments aren't runtime syntax.
quoted: "Annotated[int, (quoted_meta := 1)]" = 0
commented = 0  # type: Annotated[int, (comment_meta := 1)]
