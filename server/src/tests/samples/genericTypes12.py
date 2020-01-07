# This sample tests the checker's ability to enforce
# type invariance for type arguments.

# pyright: strict

from typing import Dict, Union

foo: Dict[Union[int, str], str] = {}
bar: Dict[str, str] = {}

# This should generate an error because 
# both type parameters for Dict are invariant,
# and str isn't assignable to Union[int, str].
foo = bar

