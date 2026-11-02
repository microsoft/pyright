# This sample tests recursive property return inference with receiver specialization.


class Edge:
    def __init__(self, parent: "Node"):
        self.parent = parent


class Node:
    def __init__(self, edges: dict[str, list[Edge]]):
        self.edges = edges

    @property
    def root(self):
        if not self.edges:
            return self
        edges = next(iter(self.edges.values()))
        return edges[0].parent.root


def consume(node: Node) -> None:
    pass


def demonstrate(node: Node) -> None:
    reveal_type(node.root, expected_text="Node | Unknown")
    consume(node.root)
