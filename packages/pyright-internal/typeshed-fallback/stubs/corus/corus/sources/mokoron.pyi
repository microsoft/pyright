from _typeshed import Incomplete
from collections.abc import Generator

from corus.record import Record

__all__ = ["load_mokoron"]

class MokoronRecord(Record):
    __attributes__: Incomplete
    id: Incomplete
    timestamp: Incomplete
    user: Incomplete
    text: Incomplete
    sentiment: Incomplete
    replies: Incomplete
    retweets: Incomplete
    favourites: Incomplete
    posts: Incomplete
    followers: Incomplete
    friends: Incomplete
    lists: Incomplete
    def __init__(
        self, id, timestamp, user, text, sentiment, replies, retweets, favourites, posts, followers, friends, lists
    ) -> None: ...
    @classmethod
    def from_match(cls, match): ...

def load_mokoron(path) -> Generator[Incomplete]: ...
