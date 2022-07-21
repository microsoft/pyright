# This sample tests the case where a dataclass type refers to
# type that circularly refers back to the dataclass itself
# through a type alias.

from dataclasses import dataclass
from typing import List


class ClassA:
    test: "C"


@dataclass
class ClassB:
    children: "C"

    def test(self):
        for child in self.children:
            reveal_type(child, expected_text="ClassB")


C = List[ClassB]
