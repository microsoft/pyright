# This sample tests inference of constructed types (in this case,
# for "chain") when the expected type is provided by another
# constructor (in this case "list").

# pyright: strict

from concurrent.futures import Future, wait
from itertools import chain
from typing import Any, Dict

my_list = list(chain([0]))
reveal_type(my_list, expected_text="list[int]")


pending: Dict[Future[Any], Any] = {}
done_tasks = wait(list(pending.keys())).done

reveal_type(done_tasks, expected_text="set[Future[Any]]")
