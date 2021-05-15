# This sample tests the handling of tuple assignments
# where the order of assignment within the tuple is important.

from typing import Optional


class Node:
    key: str
    next: Optional["Node"] = None


node = Node()

# This should analyze fine because node.next should be assigned
# None before node is assigned None.
node.next, node = None, None
