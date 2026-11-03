# This sample checks that qualifier nesting preserves the TypedDict contract
# without permitting Required or NotRequired inside ordinary type arguments.

from typing import Annotated, NotRequired, ReadOnly, Required, TypedDict

from typedDictReadOnly4 import Aliased, OptionalFields, RequiredFields


class Box[T]:
    pass


# Each of these declarations should generate an error because required-key
# qualifiers cannot be nested within a container or ordinary generic.
InvalidList = TypedDict("InvalidList", {"value": list[NotRequired[int]]})
InvalidDict = TypedDict("InvalidDict", {"value": dict[str, Required[int]]})
InvalidTuple = TypedDict("InvalidTuple", {"value": tuple[Annotated[NotRequired[int], "metadata"]]})
InvalidBox = TypedDict("InvalidBox", {"value": Box[ReadOnly[Required[int]]]})

# These should generate errors because a wrapper does not make a required-key
# qualifier valid outside a TypedDict declaration.
outside_optional: Annotated[NotRequired[int], "metadata"]
outside_required: Annotated[Required[int], "metadata"]

# This should generate an error because all the fields remain required.
missing_required: RequiredFields = {}

# This should generate an error because the value type remains int.
wrong_value: OptionalFields = {"key-0": "not an int"}


def readonly_fields(optional: OptionalFields, required: RequiredFields, aliased: Aliased) -> None:
    # Each write should generate an error, in every qualifier order.
    optional["key-0"] = 1
    required["key-0"] = 1
    optional["key-1"] = 1
    required["key-1"] = 1
    optional["key-2"] = 1
    required["key-2"] = 1
    optional["key-3"] = 1
    required["key-3"] = 1
    optional["key-4"] = 1
    required["key-4"] = 1
    optional["key-5"] = 1
    required["key-5"] = 1
    optional["key-6"] = 1
    required["key-6"] = 1
    optional["key-7"] = 1
    required["key-7"] = 1
    aliased["optional"] = 1
    aliased["required"] = 1


# Each of these should generate an error because required-key qualifiers conflict.
ConflictReadonly = TypedDict("ConflictReadonly", {"value": ReadOnly[Required[NotRequired[int]]]})
ConflictAnnotated = TypedDict("ConflictAnnotated", {"value": Annotated[NotRequired[Required[int]], "metadata"]})


def shadowed_qualifier_name() -> None:
    class ReadOnly[T]:
        pass

    # This should generate an error: this ReadOnly is an ordinary generic.
    Shadowed = TypedDict("Shadowed", {"value": ReadOnly[NotRequired[int]]})
