# This sample tests the case where a TypedDict is narrowed based
# on an "in" type guard, and the narrowed type is later combined
# with the original wider type. We want to verify that this
# doesn't result in a combinatorial explosion.

from typing import TypedDict


class GroupsSettingsDict(TypedDict, total=False):
    a: bool | None
    b: bool | None
    c: bool | None
    d: bool | None
    e: bool | None
    f: bool | None
    g: bool | None
    h: bool | None
    i: bool | None
    j: bool | None
    k: bool | None
    l: bool | None
    m: bool | None
    n: bool | None
    o: bool | None
    p: bool | None


def foo() -> None:
    settings: GroupsSettingsDict = {}

    if "a" in settings:
        settings["a"]
    if "b" in settings:
        settings["b"]
    if "c" in settings:
        settings["c"]
    if "d" in settings:
        settings["d"]
    if "e" in settings:
        settings["e"]
    if "f" in settings:
        settings["f"]
    if "g" in settings:
        settings["g"]
    if "h" in settings:
        settings["h"]
    if "i" in settings:
        settings["i"]
    if "j" in settings:
        settings["j"]
    if "k" in settings:
        settings["k"]
    if "l" in settings:
        settings["l"]
    if "m" in settings:
        settings["m"]
    if "n" in settings:
        settings["n"]
    if "o" in settings:
        settings["o"]
    if "p" in settings:
        settings["p"]
