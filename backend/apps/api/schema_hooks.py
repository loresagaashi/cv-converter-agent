"""Schema hooks for drf-spectacular."""

from typing import Any


TAG_NAME_MAP = {
    "users": "Users",
    "cv": "CV",
    "interview": "Interview",
    "llm": "LLM",
    "vector-search": "Vector Search",
}

METHOD_DEFAULT_RANK = 99
METHOD_RANK = {
    "get": 0,
    "post": 2,
    "put": 3,
    "patch": 4,
    "delete": 5,
}


def _path_section(path: str) -> str:
    parts = [part for part in path.split("/") if part]
    if len(parts) >= 2 and parts[0] == "api":
        return parts[1]
    return "zzz"


def _method_rank(path: str, method: str) -> int:
    lower_method = method.lower()
    return METHOD_RANK.get(lower_method, METHOD_DEFAULT_RANK)


def order_endpoints_with_delete_last(endpoints: list[tuple[Any, ...]]) -> list[tuple[Any, ...]]:
    """Sort endpoints by section, then desired method order, then path.

    Target order in each section:
    1) GET (all detail/list GET endpoints)
    3) POST
    4) PUT
    5) PATCH
    6) DELETE
    """

    def endpoint_key(endpoint: tuple[Any, ...]) -> tuple[str, int, str, str]:
        path, _path_regex, method, _callback = endpoint
        return (
            _path_section(path),
            _method_rank(path, method),
            path,
            method.lower(),
        )

    return sorted(endpoints, key=endpoint_key)


def group_operations_by_top_level_tag(
    result: dict[str, Any], generator: Any, request: Any, public: bool
) -> dict[str, Any]:
    """Assign Swagger tags based on the first path segment after /api/."""
    paths = result.get("paths", {})

    for path, operations in paths.items():
        # Example path: /api/users/login/
        # We want: users
        parts = [part for part in path.split("/") if part]

        tag = "API"
        if len(parts) >= 2 and parts[0] == "api":
            tag = TAG_NAME_MAP.get(parts[1], parts[1].replace("-", " ").title())

        for method, operation in operations.items():
            if method.lower() not in {
                "get",
                "post",
                "put",
                "patch",
                "delete",
                "options",
                "head",
                "trace",
            }:
                continue

            if isinstance(operation, dict):
                operation["tags"] = [tag]

    return result
