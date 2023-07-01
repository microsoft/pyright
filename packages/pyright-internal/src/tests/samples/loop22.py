# This sample tests a case where a loop contains multiple conditional
# checks.

# pyright: strict

from __future__ import annotations


class ListNode:
    def __init__(self, val: int = 0, next: ListNode | None = None):
        self.val = val
        self.next = next


def has_cycle(head: ListNode | None) -> bool:
    fast_head = head
    while head and fast_head:
        fast_head = fast_head.next
        if fast_head:
            fast_head = fast_head.next
    return False
