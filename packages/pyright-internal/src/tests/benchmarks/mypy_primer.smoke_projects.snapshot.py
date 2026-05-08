from mypy_primer.model import Project


def get_projects() -> list[Project]:
    return [
        Project(
            location="https://github.com/hauntsaninja/mypy_primer",
            pyright_cmd="{pyright} {paths}",
            paths=["."],
        ),
        Project(
            location="https://github.com/psf/black",
            pyright_cmd="{pyright} {paths}",
            paths=["src"],
        ),
        Project(
            location="https://github.com/pytest-dev/pytest",
            pyright_cmd="{pyright} {paths}",
            paths=["src", "testing"],
        ),
        Project(
            location="https://github.com/pandas-dev/pandas",
            pyright_cmd="{pyright} {paths}",
            paths=["pandas"],
        ),
        Project(
            location="https://github.com/python-attrs/attrs",
            pyright_cmd="{pyright}",
        ),
        Project(
            location="https://github.com/Textualize/rich",
            pyright_cmd="{pyright}",
        ),
        Project(
            location="https://github.com/niklasf/python-chess",
            pyright_cmd="{pyright} {paths}",
            paths=["chess"],
        ),
        Project(
            location="https://github.com/pypa/packaging",
            pyright_cmd="{pyright} {paths}",
            paths=["src"],
        ),
        Project(
            location="https://github.com/pydantic/pydantic",
            pyright_cmd="{pyright} {paths}",
            paths=["pydantic"],
        ),
        Project(
            location="https://github.com/wemake-services/django-modern-rest",
            pyright_cmd="{pyright}",
            paths=["dmr"],
        ),
    ]
