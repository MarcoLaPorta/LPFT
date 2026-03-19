from __future__ import annotations

import sys
from pathlib import Path

_shared_dir = Path(__file__).resolve().parents[2] / "shared"
if _shared_dir.is_dir():
    shared_path = str(_shared_dir)
    if shared_path not in sys.path:
        sys.path.append(shared_path)
