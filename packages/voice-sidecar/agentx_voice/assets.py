from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import threading
import time
from pathlib import Path
from typing import Any

from agentx_voice.manifest import bundled_asset_dir, get_asset_spec

KIND_ALIASES = {
    "vad": "vad-model",
    "stt": "stt-model",
    "tts": "tts-model",
    "tts-voice": "tts-voice",
}


def emit_progress(percent: int, detail: str = "") -> None:
    print(f"AGENTX_PROGRESS:{percent}:{detail}", file=sys.stderr, flush=True)


def normalize_kind(kind: object) -> str:
    raw = str(kind or "")
    return KIND_ALIASES.get(raw, raw)


def compute_directory_sha256(directory: Path) -> str:
    hasher = hashlib.sha256()
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue
        relative = str(path.relative_to(directory)).replace("\\", "/")
        hasher.update(relative.encode("utf-8"))
        hasher.update(path.read_bytes())
    return hasher.hexdigest()


def _finalize_asset(asset_id: str, spec: dict[str, Any], target: Path) -> dict[str, object]:
    sha256 = spec.get("sha256") or compute_directory_sha256(target)
    pinned = spec.get("sha256")
    if pinned and sha256 != pinned:
        raise SystemExit(f"Checksum mismatch for {asset_id}: expected {pinned}, got {sha256}")
    return {
        "assetId": asset_id,
        "path": str(target),
        "kind": normalize_kind(spec.get("kind")),
        "sha256": sha256,
    }


def _stage_target(data_dir: Path, spec: dict[str, Any]) -> tuple[Path, Path]:
    target = data_dir / str(spec["target"])
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_target = target.with_name(f".{target.name}.tmp")
    if tmp_target.exists():
        shutil.rmtree(tmp_target)
    return target, tmp_target


def _promote_tmp(tmp_target: Path, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    tmp_target.rename(target)


def _flatten_dir(root: Path) -> None:
    """Move all files from subdirectories into the root directory, then remove empty dirs."""
    for path in root.rglob("*"):
        if path.is_file() and path.parent != root:
            dest = root / path.name
            shutil.move(str(path), str(dest))
    # Remove now-empty subdirectories
    for path in sorted(root.rglob("*"), reverse=True):
        if path.is_dir():
            try:
                path.rmdir()
            except OSError:
                pass


def copy_bundled_asset(asset_id: str, data_dir: Path, spec: dict[str, Any]) -> dict[str, object]:
    bundled = bundled_asset_dir(asset_id)
    if bundled is None:
        raise FileNotFoundError(f"Bundled asset not found: {asset_id}")

    target, tmp_target = _stage_target(data_dir, spec)
    shutil.copytree(bundled, tmp_target)
    _promote_tmp(tmp_target, target)
    return _finalize_asset(asset_id, spec, target)


def _http_get(url: str) -> bytes:
    try:
        import httpx
        return httpx.get(url, timeout=300, follow_redirects=True).content
    except ImportError:
        import urllib.request
        req = urllib.request.Request(url, headers={"User-Agent": "agentx-voice/1.0"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            return resp.read()


def download_from_github(spec: dict[str, Any], source: dict[str, Any], data_dir: Path, asset_id: str) -> dict[str, object]:
    repo = str(source["repo"])
    ref = str(source.get("ref") or "master")
    target, tmp_target = _stage_target(data_dir, spec)
    tmp_target.mkdir(parents=True)

    url = f"https://github.com/{repo}/archive/refs/heads/{ref}.zip"
    import zipfile
    with zipfile.ZipFile(io.BytesIO(_http_get(url))) as archive:
        prefix = f"{repo.split('/')[-1]}-{ref}/"
        for member in archive.namelist():
            if not member.startswith(prefix) or member.endswith("/"):
                continue
            rel = member[len(prefix):]
            if not rel:
                continue
            dest = tmp_target / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as src, dest.open("wb") as out:
                shutil.copyfileobj(src, out)

    _promote_tmp(tmp_target, target)
    return _finalize_asset(asset_id, spec, target)


def download_from_hf(spec: dict[str, Any], source: dict[str, Any], data_dir: Path, asset_id: str) -> dict[str, object]:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise SystemExit("huggingface-hub is required. Install sidecar dependencies first.") from exc

    target, tmp_target = _stage_target(data_dir, spec)
    expected_mb = spec.get("sizeMB")
    stop_event = threading.Event()

    def watch_size() -> None:
        while not stop_event.is_set():
            try:
                total = sum(
                    path.stat().st_size
                    for path in tmp_target.rglob("*")
                    if path.is_file()
                )
                if isinstance(expected_mb, (int, float)) and expected_mb > 0:
                    pct = min(85, 10 + int((total / (expected_mb * 1024 * 1024)) * 75))
                    emit_progress(pct, f"Downloading {asset_id} · {total // (1024 * 1024)} MB")
                else:
                    emit_progress(40, f"Downloading {asset_id} · {total // (1024 * 1024)} MB")
            except OSError:
                pass
            time.sleep(1.5)

    emit_progress(5, f"Starting download for {asset_id}")
    watcher = threading.Thread(target=watch_size, daemon=True)
    watcher.start()
    try:
        download_kwargs: dict[str, Any] = {
            "repo_id": str(source["repo"]),
            "revision": str(source.get("revision") or "main"),
            "local_dir": str(tmp_target),
            "local_dir_use_symlinks": False,
        }
        # allow_patterns lets us download only specific files from large repos
        # (e.g. a single voice from a multi-language repo).
        allow_patterns = source.get("allowPatterns")
        if isinstance(allow_patterns, list) and allow_patterns:
            download_kwargs["allow_patterns"] = [str(p) for p in allow_patterns]
        snapshot_download(**download_kwargs)
    finally:
        stop_event.set()
        watcher.join(timeout=2)
    emit_progress(90, f"Finalizing {asset_id}")
    # If flatten is requested, move all files from subdirectories to the root of tmp_target
    if source.get("flatten"):
        _flatten_dir(tmp_target)
    _promote_tmp(tmp_target, target)
    return _finalize_asset(asset_id, spec, target)


def download_from_mirror(spec: dict[str, Any], source: dict[str, Any], data_dir: Path, asset_id: str) -> dict[str, object]:
    url = str(source["url"])
    archive_type = str(source.get("archive") or "zip")
    target, tmp_target = _stage_target(data_dir, spec)

    payload = _http_get(url)
    if archive_type == "zip":
        import zipfile
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            archive.extractall(tmp_target)
    elif archive_type == "tar.gz":
        import tarfile
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            archive.extractall(tmp_target)
    else:
        raise ValueError(f"Unsupported mirror archive type: {archive_type}")

    _promote_tmp(tmp_target, target)
    return _finalize_asset(asset_id, spec, target)


def download_from_github_release(spec: dict[str, Any], source: dict[str, Any], data_dir: Path, asset_id: str) -> dict[str, object]:
    repo = str(source["repo"])
    tag = str(source["tag"])
    assets = source.get("assets") or [source.get("asset")]
    assets = [str(a) for a in assets if a]
    if not assets:
        raise ValueError(f"github-release source for {asset_id} must specify 'asset' or 'assets'")

    target, tmp_target = _stage_target(data_dir, spec)
    tmp_target.mkdir(parents=True)
    expected_mb = spec.get("sizeMB") or 0

    for i, asset_name in enumerate(assets):
        url = f"https://github.com/{repo}/releases/download/{tag}/{asset_name}"
        emit_progress(5 + int(i * 80 / max(len(assets), 1)), f"Downloading {asset_id} · {asset_name}")
        _download_file_streaming(url, tmp_target / asset_name, asset_id, asset_name, expected_mb)

    emit_progress(90, f"Finalizing {asset_id}")
    _promote_tmp(tmp_target, target)
    return _finalize_asset(asset_id, spec, target)


def _download_file_streaming(url: str, dest_path: Path, asset_id: str, asset_name: str, expected_mb: float) -> None:
    """Download a file with progress reporting, streaming to disk.

    Prefers httpx (handles SSL certs correctly on macOS). Falls back to urllib
    with an unverified SSL context as a last resort — the bundled Python venv
    may not have system CA certificates configured.
    """
    try:
        import httpx

        with httpx.stream("GET", url, timeout=300, follow_redirects=True, headers={"User-Agent": "agentx-voice/1.0"}) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            with dest_path.open("wb") as f:
                for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
                    downloaded += len(chunk)
                    _emit_download_progress(asset_id, downloaded, total, expected_mb)
        return
    except ImportError:
        pass

    # Fallback: urllib with unverified SSL context (macOS bundled Python)
    import ssl
    import urllib.request

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(url, headers={"User-Agent": "agentx-voice/1.0"})
    with urllib.request.urlopen(req, timeout=300, context=ctx) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        with dest_path.open("wb") as f:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                _emit_download_progress(asset_id, downloaded, total, expected_mb)


def _emit_download_progress(asset_id: str, downloaded: int, total: int, expected_mb: float) -> None:
    if total > 0:
        pct = min(85, 5 + int((downloaded / total) * 80))
    elif expected_mb and expected_mb > 0:
        pct = min(85, 5 + int((downloaded / (expected_mb * 1024 * 1024)) * 80))
    else:
        pct = 50
    emit_progress(pct, f"Downloading {asset_id} · {downloaded // (1024 * 1024)} MB")


def download_from_source(asset_id: str, spec: dict[str, Any], source: dict[str, Any], data_dir: Path) -> dict[str, object]:
    source_type = str(source.get("type"))
    if source_type == "github":
        return download_from_github(spec, source, data_dir, asset_id)
    if source_type == "hf":
        return download_from_hf(spec, source, data_dir, asset_id)
    if source_type == "mirror":
        return download_from_mirror(spec, source, data_dir, asset_id)
    if source_type == "github-release":
        return download_from_github_release(spec, source, data_dir, asset_id)
    raise ValueError(f"Unsupported source type: {source_type}")


def download_asset(asset_id: str, data_dir: Path) -> dict[str, object]:
    spec = get_asset_spec(asset_id)
    alias_of = spec.get("aliasOf")
    if alias_of:
        primary = get_asset_spec(str(alias_of))
        primary_target = data_dir / str(primary["target"])
        if primary_target.exists():
            return _finalize_asset(asset_id, spec, primary_target)

    bundled = bundled_asset_dir(asset_id)
    if bundled is not None:
        return copy_bundled_asset(asset_id, data_dir, spec)

    errors: list[str] = []
    for source in spec.get("sources", []):
        try:
            return download_from_source(asset_id, spec, source, data_dir)
        except Exception as exc:
            errors.append(str(exc))

    raise SystemExit(f"All download sources failed for {asset_id}: {'; '.join(errors)}")


def delete_asset(asset_id: str, data_dir: Path) -> dict[str, object]:
    spec = get_asset_spec(asset_id)
    target = data_dir / str(spec["target"])
    shutil.rmtree(target, ignore_errors=True)
    return {"assetId": asset_id, "deleted": True}


def main() -> None:
    parser = argparse.ArgumentParser(description="Agent-X voice asset manager")
    sub = parser.add_subparsers(dest="command", required=True)

    for command in ("download", "delete"):
        p = sub.add_parser(command)
        p.add_argument("--asset-id", required=True)
        p.add_argument("--data-dir", required=True)

    args = parser.parse_args()
    data_dir = Path(args.data_dir).expanduser().resolve()

    if args.command == "download":
        result = download_asset(args.asset_id, data_dir)
    else:
        result = delete_asset(args.asset_id, data_dir)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
