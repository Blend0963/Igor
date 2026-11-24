"""Home Assistant calls a view's handler as handler(request, **match_info): a
view whose URL has {parameters} must take them, or every request is a 500."""

import ast
import pathlib

SRC = pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/__init__.py"


def test_views_with_url_parameters_accept_them():
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    checked = 0
    for cls in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
        url = None
        for st in cls.body:
            if isinstance(st, ast.Assign) and any(getattr(t, "id", "") == "url" for t in st.targets):
                url = getattr(st.value, "value", None)
        if not isinstance(url, str) or "{" not in url:
            continue
        for fn in cls.body:
            if isinstance(fn, ast.AsyncFunctionDef) and fn.name in ("get", "post"):
                names = {a.arg for a in fn.args.args + fn.args.kwonlyargs}
                params = [p.split("}")[0].split(":")[0] for p in url.split("{")[1:]]
                assert fn.args.kwarg or all(p in names for p in params), f"{cls.name}.{fn.name} ne reçoit pas {params}"
                checked += 1
    assert checked >= 3
