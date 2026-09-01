# import_heavy.py — many import statements for resolution benchmarking

from __future__ import annotations

# Standard library imports (varied styles)
import os
import sys
import io
import re
import json
import csv
import math
import time
import copy
import enum
import abc
import ast
import dis
import ssl
import xml
import html
import http
import uuid
import zlib
import gzip
import lzma
import bz2
import base64
import hashlib
import hmac
import secrets
import random
import struct
import array
import queue
import heapq
import bisect
import decimal
import fractions
import statistics
import string
import textwrap
import unicodedata
import difflib
import pprint
import reprlib
import warnings
import traceback
import linecache
import inspect
import dis
import code
import codeop
import compile
import compileall

# From imports
from os import path, getcwd, listdir, makedirs, remove, rename
from os.path import (
    join,
    exists,
    isfile,
    isdir,
    basename,
    dirname,
    abspath,
    relpath,
    normpath,
    splitext,
    getsize,
    getmtime,
)
from sys import argv, exit, stdin, stdout, stderr, platform, version
from io import BytesIO, StringIO, BufferedReader, TextIOWrapper
from re import compile, match, search, findall, sub, split, Pattern, Match
from json import dumps, loads, dump, load, JSONEncoder, JSONDecoder
from csv import reader, writer, DictReader, DictWriter
from math import (
    ceil,
    floor,
    sqrt,
    pow,
    log,
    log2,
    log10,
    exp,
    sin,
    cos,
    tan,
    pi,
    e,
    inf,
    nan,
    isnan,
    isinf,
    isfinite,
    gcd,
    factorial,
)
from time import time as time_func, sleep, monotonic, perf_counter
from copy import copy as shallow_copy, deepcopy
from enum import Enum, IntEnum, Flag, IntFlag, auto, unique
from abc import ABC, ABCMeta, abstractmethod
from collections import (
    OrderedDict,
    defaultdict,
    deque,
    Counter,
    namedtuple,
    ChainMap,
)
from collections.abc import (
    Iterable,
    Iterator,
    Generator,
    Sequence,
    MutableSequence,
    Set,
    MutableSet,
    Mapping,
    MutableMapping,
    Callable,
    Hashable,
    Sized,
    Container,
    Reversible,
    Collection,
    Awaitable,
    Coroutine,
    AsyncIterator,
    AsyncIterable,
    AsyncGenerator,
)
from typing import (
    Any,
    ClassVar,
    Dict,
    Final,
    Generic,
    List,
    Literal,
    Optional,
    Protocol,
    Set as TSet,
    Tuple,
    Type,
    TypeVar,
    Union,
    cast,
    overload,
    runtime_checkable,
    get_type_hints,
    TYPE_CHECKING,
    NamedTuple,
    TypedDict,
    Annotated,
    TypeAlias,
    TypeGuard,
    Never,
    Self,
    Unpack,
    ParamSpec,
    Concatenate,
    assert_type,
    reveal_type,
    dataclass_transform,
    no_type_check,
)
from functools import (
    reduce,
    partial,
    lru_cache,
    wraps,
    total_ordering,
    singledispatch,
    cached_property,
)
from itertools import (
    chain,
    combinations,
    permutations,
    product,
    repeat,
    count,
    cycle,
    islice,
    groupby,
    starmap,
    accumulate,
    zip_longest,
    compress,
    filterfalse,
    takewhile,
    dropwhile,
    tee,
)
from contextlib import (
    contextmanager,
    asynccontextmanager,
    closing,
    suppress,
    redirect_stdout,
    redirect_stderr,
    nullcontext,
    ExitStack,
    AbstractContextManager,
)
from dataclasses import dataclass, field, fields, asdict, astuple, make_dataclass
from pathlib import Path, PurePath, PosixPath, WindowsPath, PurePosixPath
from datetime import datetime, date, time as dt_time, timedelta, timezone
from urllib.parse import (
    urlparse,
    urlencode,
    urljoin,
    quote,
    unquote,
    parse_qs,
    parse_qsl,
    urlsplit,
    urlunsplit,
)
from http import HTTPStatus
from http.client import HTTPConnection, HTTPSConnection, HTTPResponse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from xml.etree import ElementTree
from xml.dom import minidom
from html.parser import HTMLParser
from concurrent.futures import (
    ThreadPoolExecutor,
    ProcessPoolExecutor,
    Future,
    as_completed,
    wait,
    FIRST_COMPLETED,
    ALL_COMPLETED,
)
from threading import Thread, Lock, RLock, Event, Condition, Semaphore, Timer
from multiprocessing import Process, Pool, Queue as MPQueue, Value, Array, Manager
from subprocess import run, Popen, PIPE, DEVNULL, CalledProcessError
from shutil import copy2, copytree, rmtree, move, which, disk_usage
from tempfile import (
    TemporaryFile,
    NamedTemporaryFile,
    mkdtemp,
    mkstemp,
    gettempdir,
    SpooledTemporaryFile,
)
from unittest import TestCase, TestSuite, TestLoader, TextTestRunner, mock
from unittest.mock import Mock, MagicMock, patch, call, ANY, PropertyMock
from logging import (
    Logger,
    getLogger,
    StreamHandler,
    FileHandler,
    Formatter,
    DEBUG,
    INFO,
    WARNING,
    ERROR,
    CRITICAL,
    basicConfig,
)
from argparse import ArgumentParser, Namespace, FileType, Action, HelpFormatter
from configparser import ConfigParser, RawConfigParser
from socket import socket, AF_INET, AF_INET6, SOCK_STREAM, SOCK_DGRAM
from signal import signal, SIGINT, SIGTERM, SIG_DFL, SIG_IGN
from weakref import ref, WeakValueDictionary, WeakKeyDictionary, finalize
from operator import (
    add,
    sub,
    mul,
    truediv,
    floordiv,
    mod,
    pow as op_pow,
    neg,
    pos,
    abs as op_abs,
    eq,
    ne,
    lt,
    le,
    gt,
    ge,
    and_,
    or_,
    xor,
    not_,
    itemgetter,
    attrgetter,
    methodcaller,
)

# Conditional imports
if TYPE_CHECKING:
    from _typeshed import SupportsRead, SupportsWrite, StrPath
    from typing_extensions import Buffer, ReadOnly

# Aliased imports
import os.path as osp
import collections.abc as cabc
import xml.etree.ElementTree as ET

# Try/except imports (common pattern)
try:
    import numpy as np  # type: ignore
except ImportError:
    np = None  # type: ignore

try:
    import pandas as pd  # type: ignore
except ImportError:
    pd = None  # type: ignore

try:
    import requests  # type: ignore
except ImportError:
    requests = None  # type: ignore

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None  # type: ignore

try:
    import toml  # type: ignore
except ImportError:
    toml = None  # type: ignore


# Code that uses imported names to exercise resolution
def use_imports() -> None:
    """Function that references many imported names."""
    p = Path(".")
    files = list(p.iterdir())
    cwd = getcwd()

    data: Dict[str, Any] = {"key": "value"}
    json_str = dumps(data)
    parsed = loads(json_str)

    now = datetime.now()
    delta = timedelta(days=1)
    tomorrow = now + delta

    url = urlparse("https://example.com/path?key=value")

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(lambda x: x * 2, i) for i in range(10)]

    parser = ArgumentParser(description="test")
    parser.add_argument("--verbose", action="store_true")

    logger = getLogger(__name__)
    logger.setLevel(DEBUG)

    tmp_dir = mkdtemp()
    result = sqrt(144)
    items = list(chain([1, 2], [3, 4], [5, 6]))
    grouped = groupby(sorted(items), key=lambda x: x % 2)

    counter = Counter(items)

    # Type aliases using imported types
    Config: TypeAlias = Dict[str, Union[str, int, float, bool, List[Any]]]
    Handler: TypeAlias = Callable[[str, int], Optional[bool]]
    DataRow: TypeAlias = Tuple[int, str, float, Optional[str]]

    _ = (p, files, cwd, data, json_str, parsed, now, delta, tomorrow, url,
         parser, logger, tmp_dir, result, items, grouped, counter)


# End of import_heavy.py
