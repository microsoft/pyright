# This sample tests type evaluation for a nested loop that involves
# accesses to an instance variable accessed through a member access
# expression that requires narrowing.

from concurrent import futures
from concurrent.futures import Future
from typing import Any, Dict, Optional


class A:
    def __init__(self):
        self.pending: Optional[Dict[Future[Any], int]]
        self.foo: bool

    def poll(self):
        assert self.pending is not None
        while True:
            if self.pending:
                pass

            ready, _ = futures.wait(self.pending)

            for future_id in ready:
                self.pending.pop(future_id)

                future_id.result()
                if self.foo:
                    pass
