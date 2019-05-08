# This sample tests the type checker's type inference logic for
# dictionaries.

from typing import Dict

def wantsIntDict(a: Dict[int, int]):
    pass

wantsIntDict({3: 3, 5: 5})
wantsIntDict({x: x for x in [2, 3, 4]})

# This should generate an error because
# the type is wrong.
wantsIntDict({'hello': 3, 'bye': 5})

# This should generate an error because
# the type is wrong.
wantsIntDict({'sdf': x for x in [2, 3, 4]})



