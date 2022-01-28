# This sample tests the handling of the "|" and "|=" operators
# for TypedDicts.

from typing import TypedDict


class Person(TypedDict, total=False):
    name: str
    age: int


person: Person = {}

person.update({"name": "Michael"})

person |= {"name": "Michael"}
person = person | {"name": "Michael"}


# This should generate an error.
person |= {"name": "Michael", "other": 1}

# This should generate an error.
person = person | {"name": 1}
