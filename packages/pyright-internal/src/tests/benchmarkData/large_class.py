# large_class.py — class with 200+ methods for member completion benchmarking

from __future__ import annotations

from typing import (
    Any,
    ClassVar,
    Dict,
    Iterator,
    List,
    Optional,
    Sequence,
    Set,
    Tuple,
    TypeVar,
    Union,
)

_T = TypeVar("_T")


class LargeClass:
    """A class with many methods to stress member completion."""

    # Class variables
    VERSION: ClassVar[str] = "1.0.0"
    MAX_SIZE: ClassVar[int] = 1000
    DEFAULT_NAME: ClassVar[str] = "unnamed"

    # Instance variables
    _name: str
    _data: List[Any]
    _metadata: Dict[str, Any]
    _flags: Set[str]
    _parent: Optional[LargeClass]
    _children: List[LargeClass]
    _cache: Dict[str, Any]
    _counter: int

    def __init__(
        self,
        name: str,
        data: Optional[List[Any]] = None,
        parent: Optional[LargeClass] = None,
    ) -> None:
        self._name = name
        self._data = data or []
        self._metadata = {}
        self._flags = set()
        self._parent = parent
        self._children = []
        self._cache = {}
        self._counter = 0

    # --- Properties (20) ---

    @property
    def name(self) -> str:
        return self._name

    @name.setter
    def name(self, value: str) -> None:
        self._name = value

    @property
    def data(self) -> List[Any]:
        return self._data

    @property
    def metadata(self) -> Dict[str, Any]:
        return self._metadata

    @property
    def flags(self) -> Set[str]:
        return self._flags

    @property
    def parent(self) -> Optional[LargeClass]:
        return self._parent

    @property
    def children(self) -> List[LargeClass]:
        return self._children

    @property
    def size(self) -> int:
        return len(self._data)

    @property
    def is_empty(self) -> bool:
        return len(self._data) == 0

    @property
    def is_root(self) -> bool:
        return self._parent is None

    @property
    def is_leaf(self) -> bool:
        return len(self._children) == 0

    @property
    def depth(self) -> int:
        d = 0
        node = self._parent
        while node is not None:
            d += 1
            node = node._parent
        return d

    @property
    def path(self) -> str:
        parts: List[str] = []
        node: Optional[LargeClass] = self
        while node is not None:
            parts.append(node._name)
            node = node._parent
        parts.reverse()
        return "/".join(parts)

    @property
    def root(self) -> LargeClass:
        node = self
        while node._parent is not None:
            node = node._parent
        return node

    @property
    def siblings(self) -> List[LargeClass]:
        if self._parent is None:
            return []
        return [c for c in self._parent._children if c is not self]

    @property
    def descendant_count(self) -> int:
        count = len(self._children)
        for child in self._children:
            count += child.descendant_count
        return count

    @property
    def total_data_size(self) -> int:
        total = len(self._data)
        for child in self._children:
            total += child.total_data_size
        return total

    @property
    def counter(self) -> int:
        return self._counter

    @property
    def cache_size(self) -> int:
        return len(self._cache)

    @property
    def has_metadata(self) -> bool:
        return len(self._metadata) > 0

    # --- Data manipulation methods (40) ---

    def add_item(self, item: Any) -> None:
        self._data.append(item)

    def add_items(self, items: Sequence[Any]) -> None:
        self._data.extend(items)

    def insert_item(self, index: int, item: Any) -> None:
        self._data.insert(index, item)

    def remove_item(self, item: Any) -> bool:
        try:
            self._data.remove(item)
            return True
        except ValueError:
            return False

    def pop_item(self, index: int = -1) -> Any:
        return self._data.pop(index)

    def clear_data(self) -> None:
        self._data.clear()

    def sort_data(self, reverse: bool = False) -> None:
        self._data.sort(reverse=reverse)

    def reverse_data(self) -> None:
        self._data.reverse()

    def get_item(self, index: int) -> Any:
        return self._data[index]

    def get_items(self, start: int, end: int) -> List[Any]:
        return self._data[start:end]

    def set_item(self, index: int, value: Any) -> None:
        self._data[index] = value

    def find_item(self, item: Any) -> int:
        try:
            return self._data.index(item)
        except ValueError:
            return -1

    def contains_item(self, item: Any) -> bool:
        return item in self._data

    def count_item(self, item: Any) -> int:
        return self._data.count(item)

    def first_item(self) -> Optional[Any]:
        return self._data[0] if self._data else None

    def last_item(self) -> Optional[Any]:
        return self._data[-1] if self._data else None

    def unique_items(self) -> List[Any]:
        seen: Set[Any] = set()
        result: List[Any] = []
        for item in self._data:
            if item not in seen:
                seen.add(item)
                result.append(item)
        return result

    def filter_items(self, predicate: Any) -> List[Any]:
        return [item for item in self._data if predicate(item)]

    def map_items(self, func: Any) -> List[Any]:
        return [func(item) for item in self._data]

    def reduce_items(self, func: Any, initial: Any = None) -> Any:
        result = initial
        for item in self._data:
            if result is None:
                result = item
            else:
                result = func(result, item)
        return result

    def zip_with(self, other: Sequence[Any]) -> List[Tuple[Any, Any]]:
        return list(zip(self._data, other))

    def enumerate_items(self) -> List[Tuple[int, Any]]:
        return list(enumerate(self._data))

    def chunk_data(self, size: int) -> List[List[Any]]:
        return [self._data[i : i + size] for i in range(0, len(self._data), size)]

    def flatten_data(self) -> List[Any]:
        result: List[Any] = []
        for item in self._data:
            if isinstance(item, list):
                result.extend(item)
            else:
                result.append(item)
        return result

    def take_items(self, n: int) -> List[Any]:
        return self._data[:n]

    def drop_items(self, n: int) -> List[Any]:
        return self._data[n:]

    def sample_items(self, n: int) -> List[Any]:
        import random
        return random.sample(self._data, min(n, len(self._data)))

    def shuffle_data(self) -> None:
        import random
        random.shuffle(self._data)

    def min_item(self) -> Optional[Any]:
        return min(self._data) if self._data else None

    def max_item(self) -> Optional[Any]:
        return max(self._data) if self._data else None

    def sum_items(self) -> Any:
        return sum(self._data) if self._data else 0

    def average_items(self) -> Optional[float]:
        if not self._data:
            return None
        return sum(self._data) / len(self._data)

    def group_by(self, key_func: Any) -> Dict[Any, List[Any]]:
        groups: Dict[Any, List[Any]] = {}
        for item in self._data:
            k = key_func(item)
            if k not in groups:
                groups[k] = []
            groups[k].append(item)
        return groups

    def partition(self, predicate: Any) -> Tuple[List[Any], List[Any]]:
        true_items: List[Any] = []
        false_items: List[Any] = []
        for item in self._data:
            if predicate(item):
                true_items.append(item)
            else:
                false_items.append(item)
        return (true_items, false_items)

    def all_match(self, predicate: Any) -> bool:
        return all(predicate(item) for item in self._data)

    def any_match(self, predicate: Any) -> bool:
        return any(predicate(item) for item in self._data)

    def none_match(self, predicate: Any) -> bool:
        return not any(predicate(item) for item in self._data)

    def find_first(self, predicate: Any) -> Optional[Any]:
        for item in self._data:
            if predicate(item):
                return item
        return None

    def find_last(self, predicate: Any) -> Optional[Any]:
        for item in reversed(self._data):
            if predicate(item):
                return item
        return None

    def distinct_count(self) -> int:
        return len(set(self._data))

    # --- Metadata methods (20) ---

    def set_metadata(self, key: str, value: Any) -> None:
        self._metadata[key] = value

    def get_metadata(self, key: str, default: Any = None) -> Any:
        return self._metadata.get(key, default)

    def has_metadata_key(self, key: str) -> bool:
        return key in self._metadata

    def remove_metadata(self, key: str) -> Optional[Any]:
        return self._metadata.pop(key, None)

    def clear_metadata(self) -> None:
        self._metadata.clear()

    def metadata_keys(self) -> List[str]:
        return list(self._metadata.keys())

    def metadata_values(self) -> List[Any]:
        return list(self._metadata.values())

    def metadata_items(self) -> List[Tuple[str, Any]]:
        return list(self._metadata.items())

    def merge_metadata(self, other: Dict[str, Any]) -> None:
        self._metadata.update(other)

    def copy_metadata_from(self, source: LargeClass) -> None:
        self._metadata.update(source._metadata)

    def filter_metadata(self, predicate: Any) -> Dict[str, Any]:
        return {k: v for k, v in self._metadata.items() if predicate(k, v)}

    def transform_metadata_values(self, func: Any) -> Dict[str, Any]:
        return {k: func(v) for k, v in self._metadata.items()}

    def metadata_to_json(self) -> str:
        import json
        return json.dumps(self._metadata)

    def metadata_from_json(self, json_str: str) -> None:
        import json
        self._metadata = json.loads(json_str)

    def validate_metadata(self, schema: Dict[str, type]) -> List[str]:
        errors: List[str] = []
        for key, expected_type in schema.items():
            if key not in self._metadata:
                errors.append(f"Missing key: {key}")
            elif not isinstance(self._metadata[key], expected_type):
                errors.append(f"Wrong type for {key}: expected {expected_type.__name__}")
        return errors

    def metadata_diff(self, other: LargeClass) -> Dict[str, Tuple[Any, Any]]:
        all_keys = set(self._metadata.keys()) | set(other._metadata.keys())
        diff: Dict[str, Tuple[Any, Any]] = {}
        for key in all_keys:
            v1 = self._metadata.get(key)
            v2 = other._metadata.get(key)
            if v1 != v2:
                diff[key] = (v1, v2)
        return diff

    def snapshot_metadata(self) -> Dict[str, Any]:
        return dict(self._metadata)

    def restore_metadata(self, snapshot: Dict[str, Any]) -> None:
        self._metadata = dict(snapshot)

    def metadata_size_bytes(self) -> int:
        import sys
        return sys.getsizeof(self._metadata)

    def metadata_summary(self) -> str:
        return f"Metadata: {len(self._metadata)} keys"

    # --- Flag methods (15) ---

    def add_flag(self, flag: str) -> None:
        self._flags.add(flag)

    def remove_flag(self, flag: str) -> None:
        self._flags.discard(flag)

    def has_flag(self, flag: str) -> bool:
        return flag in self._flags

    def toggle_flag(self, flag: str) -> bool:
        if flag in self._flags:
            self._flags.discard(flag)
            return False
        self._flags.add(flag)
        return True

    def clear_flags(self) -> None:
        self._flags.clear()

    def set_flags(self, flags: Set[str]) -> None:
        self._flags = set(flags)

    def get_flags(self) -> Set[str]:
        return set(self._flags)

    def flag_count(self) -> int:
        return len(self._flags)

    def has_any_flag(self, flags: Set[str]) -> bool:
        return bool(self._flags & flags)

    def has_all_flags(self, flags: Set[str]) -> bool:
        return flags.issubset(self._flags)

    def common_flags(self, other: LargeClass) -> Set[str]:
        return self._flags & other._flags

    def diff_flags(self, other: LargeClass) -> Set[str]:
        return self._flags - other._flags

    def union_flags(self, other: LargeClass) -> Set[str]:
        return self._flags | other._flags

    def flags_to_list(self) -> List[str]:
        return sorted(self._flags)

    def flags_summary(self) -> str:
        return f"Flags: {', '.join(sorted(self._flags))}"

    # --- Tree methods (25) ---

    def add_child(self, child: LargeClass) -> None:
        child._parent = self
        self._children.append(child)

    def remove_child(self, child: LargeClass) -> bool:
        try:
            self._children.remove(child)
            child._parent = None
            return True
        except ValueError:
            return False

    def detach(self) -> None:
        if self._parent:
            self._parent.remove_child(self)

    def move_to(self, new_parent: LargeClass) -> None:
        self.detach()
        new_parent.add_child(self)

    def get_child(self, index: int) -> LargeClass:
        return self._children[index]

    def find_child(self, name: str) -> Optional[LargeClass]:
        for child in self._children:
            if child._name == name:
                return child
        return None

    def find_descendant(self, name: str) -> Optional[LargeClass]:
        for child in self._children:
            if child._name == name:
                return child
            found = child.find_descendant(name)
            if found is not None:
                return found
        return None

    def walk_tree(self) -> Iterator[LargeClass]:
        yield self
        for child in self._children:
            yield from child.walk_tree()

    def walk_leaves(self) -> Iterator[LargeClass]:
        if self.is_leaf:
            yield self
        else:
            for child in self._children:
                yield from child.walk_leaves()

    def ancestors(self) -> List[LargeClass]:
        result: List[LargeClass] = []
        node = self._parent
        while node is not None:
            result.append(node)
            node = node._parent
        return result

    def common_ancestor(self, other: LargeClass) -> Optional[LargeClass]:
        my_ancestors = set(id(a) for a in self.ancestors())
        node: Optional[LargeClass] = other
        while node is not None:
            if id(node) in my_ancestors:
                return node
            node = node._parent
        return None

    def subtree_size(self) -> int:
        return 1 + sum(child.subtree_size() for child in self._children)

    def height(self) -> int:
        if not self._children:
            return 0
        return 1 + max(child.height() for child in self._children)

    def is_ancestor_of(self, other: LargeClass) -> bool:
        node = other._parent
        while node is not None:
            if node is self:
                return True
            node = node._parent
        return False

    def is_descendant_of(self, other: LargeClass) -> bool:
        return other.is_ancestor_of(self)

    def child_count(self) -> int:
        return len(self._children)

    def sort_children(self, key: Optional[Any] = None) -> None:
        if key:
            self._children.sort(key=key)
        else:
            self._children.sort(key=lambda c: c._name)

    def reverse_children(self) -> None:
        self._children.reverse()

    def flatten_tree(self) -> List[LargeClass]:
        return list(self.walk_tree())

    def tree_depth_map(self) -> Dict[int, List[LargeClass]]:
        result: Dict[int, List[LargeClass]] = {}
        for node in self.walk_tree():
            d = node.depth
            if d not in result:
                result[d] = []
            result[d].append(node)
        return result

    def prune(self, predicate: Any) -> int:
        removed = 0
        keep: List[LargeClass] = []
        for child in self._children:
            if predicate(child):
                child._parent = None
                removed += 1
            else:
                keep.append(child)
                removed += child.prune(predicate)
        self._children = keep
        return removed

    def clone(self) -> LargeClass:
        new_node = LargeClass(self._name, list(self._data))
        new_node._metadata = dict(self._metadata)
        new_node._flags = set(self._flags)
        for child in self._children:
            cloned_child = child.clone()
            new_node.add_child(cloned_child)
        return new_node

    def merge_with(self, other: LargeClass) -> None:
        self._data.extend(other._data)
        self._metadata.update(other._metadata)
        self._flags.update(other._flags)
        for child in other._children:
            self.add_child(child)

    def tree_summary(self) -> str:
        return f"Tree({self._name}, children={self.child_count()}, descendants={self.descendant_count})"

    # --- Cache methods (10) ---

    def cache_get(self, key: str) -> Optional[Any]:
        return self._cache.get(key)

    def cache_set(self, key: str, value: Any) -> None:
        self._cache[key] = value

    def cache_has(self, key: str) -> bool:
        return key in self._cache

    def cache_remove(self, key: str) -> Optional[Any]:
        return self._cache.pop(key, None)

    def cache_clear(self) -> None:
        self._cache.clear()

    def cache_keys(self) -> List[str]:
        return list(self._cache.keys())

    def cache_values(self) -> List[Any]:
        return list(self._cache.values())

    def cache_items(self) -> List[Tuple[str, Any]]:
        return list(self._cache.items())

    def cache_update(self, data: Dict[str, Any]) -> None:
        self._cache.update(data)

    def cache_get_or_set(self, key: str, factory: Any) -> Any:
        if key not in self._cache:
            self._cache[key] = factory()
        return self._cache[key]

    # --- Counter methods (10) ---

    def increment(self, by: int = 1) -> int:
        self._counter += by
        return self._counter

    def decrement(self, by: int = 1) -> int:
        self._counter -= by
        return self._counter

    def reset_counter(self) -> None:
        self._counter = 0

    def set_counter(self, value: int) -> None:
        self._counter = value

    def counter_is_zero(self) -> bool:
        return self._counter == 0

    def counter_is_positive(self) -> bool:
        return self._counter > 0

    def counter_is_negative(self) -> bool:
        return self._counter < 0

    def counter_abs(self) -> int:
        return abs(self._counter)

    def counter_clamp(self, low: int, high: int) -> int:
        self._counter = max(low, min(high, self._counter))
        return self._counter

    def counter_summary(self) -> str:
        return f"Counter: {self._counter}"

    # --- Serialization methods (10) ---

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self._name,
            "data": self._data,
            "metadata": self._metadata,
            "flags": list(self._flags),
            "counter": self._counter,
            "children": [c.to_dict() for c in self._children],
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> LargeClass:
        obj = cls(d["name"], d.get("data", []))
        obj._metadata = d.get("metadata", {})
        obj._flags = set(d.get("flags", []))
        obj._counter = d.get("counter", 0)
        for child_dict in d.get("children", []):
            child = cls.from_dict(child_dict)
            obj.add_child(child)
        return obj

    def to_json(self) -> str:
        import json
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, json_str: str) -> LargeClass:
        import json
        return cls.from_dict(json.loads(json_str))

    def to_yaml_str(self) -> str:
        lines: List[str] = [f"name: {self._name}"]
        lines.append(f"counter: {self._counter}")
        lines.append(f"flags: [{', '.join(sorted(self._flags))}]")
        return "\n".join(lines)

    def copy(self) -> LargeClass:
        return LargeClass.from_dict(self.to_dict())

    def equals(self, other: LargeClass) -> bool:
        return self.to_dict() == other.to_dict()

    def hash_value(self) -> int:
        return hash((self._name, tuple(self._data), self._counter))

    def size_bytes(self) -> int:
        import sys
        return sys.getsizeof(self)

    def describe(self) -> str:
        return (
            f"LargeClass(name={self._name!r}, "
            f"data_size={len(self._data)}, "
            f"metadata_keys={len(self._metadata)}, "
            f"flags={len(self._flags)}, "
            f"children={len(self._children)}, "
            f"counter={self._counter})"
        )

    # --- Dunder methods (20) ---

    def __repr__(self) -> str:
        return f"LargeClass({self._name!r})"

    def __str__(self) -> str:
        return self._name

    def __len__(self) -> int:
        return len(self._data)

    def __bool__(self) -> bool:
        return len(self._data) > 0

    def __contains__(self, item: Any) -> bool:
        return item in self._data

    def __iter__(self) -> Iterator[Any]:
        return iter(self._data)

    def __getitem__(self, index: int) -> Any:
        return self._data[index]

    def __setitem__(self, index: int, value: Any) -> None:
        self._data[index] = value

    def __delitem__(self, index: int) -> None:
        del self._data[index]

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, LargeClass):
            return NotImplemented
        return self._name == other._name and self._data == other._data

    def __ne__(self, other: object) -> bool:
        return not self.__eq__(other)

    def __hash__(self) -> int:
        return hash(self._name)

    def __lt__(self, other: LargeClass) -> bool:
        return self._name < other._name

    def __le__(self, other: LargeClass) -> bool:
        return self._name <= other._name

    def __gt__(self, other: LargeClass) -> bool:
        return self._name > other._name

    def __ge__(self, other: LargeClass) -> bool:
        return self._name >= other._name

    def __add__(self, other: LargeClass) -> LargeClass:
        result = self.clone()
        result._data.extend(other._data)
        return result

    def __iadd__(self, other: LargeClass) -> LargeClass:
        self._data.extend(other._data)
        return self

    def __enter__(self) -> LargeClass:
        return self

    def __exit__(self, *args: Any) -> None:
        self.clear_data()
        self.clear_metadata()
        self.clear_flags()
        self.cache_clear()


# --- Subclass to add more methods for completion ancestor chain ---


class ExtendedClass(LargeClass):
    """Extension with additional domain methods."""

    _tags: List[str]
    _version: int

    def __init__(self, name: str, version: int = 1) -> None:
        super().__init__(name)
        self._tags = []
        self._version = version

    def add_tag(self, tag: str) -> None:
        self._tags.append(tag)

    def remove_tag(self, tag: str) -> None:
        if tag in self._tags:
            self._tags.remove(tag)

    def has_tag(self, tag: str) -> bool:
        return tag in self._tags

    def get_tags(self) -> List[str]:
        return list(self._tags)

    def clear_tags(self) -> None:
        self._tags.clear()

    def bump_version(self) -> int:
        self._version += 1
        return self._version

    def get_version(self) -> int:
        return self._version

    def set_version(self, version: int) -> None:
        self._version = version

    def version_string(self) -> str:
        return f"v{self._version}"

    def full_describe(self) -> str:
        base = self.describe()
        return f"{base}, tags={len(self._tags)}, version={self._version}"


# Marker for completion benchmark — trigger point
obj = ExtendedClass("test")
obj.  # completion trigger point
