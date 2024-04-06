# This sample tests the type checker's ability to handle
# circular type references within dataclass definitions.

from dataclasses import dataclass
from pathlib import Path


@dataclass
class ParentA:
    b: "ClassB"


@dataclass
class ChildA(ParentA):
    pass


@dataclass
class ClassB:
    sub_class: ChildA

    def method1(self):
        ChildA(b=self)


@dataclass()
class ClassC:
    name: str = "sample"
    dir_a: Path = Path.home().joinpath(f"source/{name}")
    dir_b: Path = dir_a.joinpath("path/to/b")
