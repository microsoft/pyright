# This sample tests synthesized get methods in TypedDict classes.

from typing import TypedDict

UserType1 = TypedDict("UserType1", {"name": str, "age": int}, total=False)
user1: UserType1 = {"name": "Bob", "age": 40}

name1: str = user1.get("name", "n/a")
age1: int = user1.get("age", 42)

UserType2 = TypedDict("UserType2", name=str, age=int)
user2: UserType2 = {"name": "Bob", "age": 40}

name2: str | None = user2.get("name")

name3: str = user2.get("name")

age2: int = user2.get("age", 42)

age3: int | str = user2.get("age", "42")

age4: int = user2.get("age", "42")
