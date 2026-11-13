from typing import Literal

from shapely import MultiPolygon, Polygon

from ..geodataframe import GeoDataFrame
from ..geoseries import GeoSeries

def make_grid(
    input_geometry: Polygon | MultiPolygon | GeoSeries | GeoDataFrame,
    /,
    cell_size: float,
    grid_type: Literal["square", "hexagon"] = "square",
    feature_type: Literal["centers", "corners", "polygons"] = "polygons",
    offset: tuple[float, float] | None = None,
    intersect: bool = True,
    flat_topped: bool = False,
) -> GeoSeries: ...
