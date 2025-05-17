from _typeshed import Incomplete
from collections.abc import Collection, Sequence

__all__ = [
    "draw",
    "draw_networkx",
    "draw_networkx_nodes",
    "draw_networkx_edges",
    "draw_networkx_labels",
    "draw_networkx_edge_labels",
    "draw_circular",
    "draw_kamada_kawai",
    "draw_random",
    "draw_spectral",
    "draw_spring",
    "draw_planar",
    "draw_shell",
    "draw_forceatlas2",
]

def draw(G, pos=None, ax=None, **kwds) -> None: ...
def draw_networkx(G, pos=None, arrows=None, with_labels: bool = True, **kwds) -> None: ...
def draw_networkx_nodes(
    G,
    pos,
    nodelist: Collection[Incomplete] | None = None,
    node_size: Incomplete | int = 300,
    node_color: str | Sequence[str] = "#1f78b4",
    node_shape: str = "o",
    alpha=None,
    cmap=None,
    vmin=None,
    vmax=None,
    ax=None,
    linewidths=None,
    edgecolors=None,
    label=None,
    margins=None,
    hide_ticks: bool = True,
): ...
def draw_networkx_edges(
    G,
    pos,
    edgelist=None,
    width: float = 1.0,
    edge_color: str = "k",
    style: str = "solid",
    alpha=None,
    arrowstyle=None,
    arrowsize: int = 10,
    edge_cmap=None,
    edge_vmin=None,
    edge_vmax=None,
    ax=None,
    arrows=None,
    label=None,
    node_size: Incomplete | int = 300,
    nodelist: list[Incomplete] | None = None,
    node_shape: str = "o",
    connectionstyle: str = "arc3",
    min_source_margin: int = 0,
    min_target_margin: int = 0,
    hide_ticks: bool = True,
): ...
def draw_networkx_labels(
    G,
    pos,
    labels=None,
    font_size: int = 12,
    font_color: str = "k",
    font_family: str = "sans-serif",
    font_weight: str = "normal",
    alpha=None,
    bbox=None,
    horizontalalignment: str = "center",
    verticalalignment: str = "center",
    ax=None,
    clip_on: bool = True,
    hide_ticks: bool = True,
): ...
def draw_networkx_edge_labels(
    G,
    pos,
    edge_labels=None,
    label_pos: float = 0.5,
    font_size: int = 10,
    font_color: str = "k",
    font_family: str = "sans-serif",
    font_weight: str = "normal",
    alpha=None,
    bbox=None,
    horizontalalignment: str = "center",
    verticalalignment: str = "center",
    ax=None,
    rotate: bool = True,
    clip_on: bool = True,
    node_size: int = 300,
    nodelist: list[Incomplete] | None = None,
    connectionstyle: str = "arc3",
    hide_ticks: bool = True,
): ...
def draw_circular(G, **kwargs) -> None: ...
def draw_kamada_kawai(G, **kwargs) -> None: ...
def draw_random(G, **kwargs) -> None: ...
def draw_spectral(G, **kwargs) -> None: ...
def draw_spring(G, **kwargs) -> None: ...
def draw_shell(G, nlist=None, **kwargs) -> None: ...
def draw_planar(G, **kwargs) -> None: ...
def draw_forceatlas2(G, **kwargs) -> None: ...
