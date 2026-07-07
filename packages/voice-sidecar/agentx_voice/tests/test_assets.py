from __future__ import annotations

from pathlib import Path

from agentx_voice.assets import compute_directory_sha256


def test_compute_directory_sha256_is_stable(tmp_path: Path) -> None:
    root = tmp_path / "asset"
    root.mkdir()
    (root / "a.txt").write_text("alpha", encoding="utf-8")
    nested = root / "nested"
    nested.mkdir()
    (nested / "b.txt").write_text("beta", encoding="utf-8")

    first = compute_directory_sha256(root)
    second = compute_directory_sha256(root)

    assert first == second
    assert len(first) == 64


def test_compute_directory_sha256_changes_when_content_changes(tmp_path: Path) -> None:
    root = tmp_path / "asset"
    root.mkdir()
    file_path = root / "a.txt"
    file_path.write_text("alpha", encoding="utf-8")

    before = compute_directory_sha256(root)
    file_path.write_text("alpha-updated", encoding="utf-8")
    after = compute_directory_sha256(root)

    assert before != after
