# This sample tests assignments to indexed expressions
# where the base is a specialized object.

from typing import List, Dict


l: List[int] = [1, 2, 3, 4, 5]
# This should generate an error because
# the assigned type is wrong.
l[0] = 'a'

d: Dict[int,str] = {1 : 'str'}
# This should generate an error because
# the assigned type is wrong.
d[1] = 123


 