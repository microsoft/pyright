# This sample tests type var matching for constrained type vars.

import pathlib
import shutil
from typing import TypeVar

class Foo:
    pass

class Bar(Foo):
    pass

X = TypeVar("X", Foo, str)
B = TypeVar("B", bound=Foo)

def test1(x: X) -> X:
    return x

def test2(x: B) -> B:
    return x

# This should generate an error because test1(Bar())
# should evaluate to type Foo, not Bar.
aa1: Bar = test1(Bar())

aa2: Foo = test1(Bar())

bb1: Bar = test2(Bar())

bb2: Foo = test2(Bar())


# The call to rmtree should not generate any errors.
data_dir = pathlib.Path("/tmp")
archive_path = data_dir / "hello"
shutil.rmtree(archive_path)