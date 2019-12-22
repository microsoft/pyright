# This sample tests synthesized get methods in TypedDict classes.

from typing_extensions import TypedDict

UserType = TypedDict("UserType", {"name": str, "age": int}, total=False)
user: UserType = {"name": "Bob", "age": 40}

name: str = user.get('name')
age: int = user.get('age', 42)

