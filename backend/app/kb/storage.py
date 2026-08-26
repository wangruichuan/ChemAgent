"""SQLite storage for knowledge base: documents + chunks tables.

Personal-scale strategy: embeddings stored as JSON text column, cosine
similarity computed in Python. Zero extra services; fast enough for
<50k chunks. Upgrade path: sqlite-vec / pgvector / vector DB later.
"""
import json
import math
import sqlite3
import threading
from pathlib import Path

from ..paths import data_root

DATA_ROOT = data_root()
DB_PATH = DATA_ROOT / "kb" / "kb.db"
FILES_DIR = DATA_ROOT / "kb" / "files"  # original uploaded files (for preview)

# Doc lifecycle
PENDING = "pending"      # uploaded, queued
PARSING = "parsing"      # extracting text (local or MinerU)
EMBEDDING = "embedding"  # generating vectors
READY = "ready"          # searchable
FAILED = "failed"

_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")  # enable ON DELETE CASCADE on chunks
    return conn


def init_db() -> None:
    with _lock, _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                filename     TEXT NOT NULL,
                file_hash    TEXT UNIQUE NOT NULL,
                doc_type     TEXT NOT NULL,            -- txt|md|pdf|docx
                status       TEXT NOT NULL DEFAULT 'pending',
                error        TEXT,
                progress     TEXT,                      -- human-readable progress hint
                summary      TEXT,                      -- AI-generated doc summary
                text_hash    TEXT,                      -- sha256 of cleaned text (dedup)
                chunk_count  INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chunks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                idx         INTEGER NOT NULL,
                content     TEXT NOT NULL,
                source      TEXT,                       -- e.g. "p.3" page hint
                embedding   TEXT                        -- JSON array of floats
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
            """
        )
        # migration: add progress column to pre-existing DBs
        cols = [r[1] for r in conn.execute("PRAGMA table_info(documents)").fetchall()]
        if "progress" not in cols:
            conn.execute("ALTER TABLE documents ADD COLUMN progress TEXT")
        if "summary" not in cols:
            conn.execute("ALTER TABLE documents ADD COLUMN summary TEXT")
        if "text_hash" not in cols:
            conn.execute("ALTER TABLE documents ADD COLUMN text_hash TEXT")


# ---------- documents ----------

def insert_document(filename: str, file_hash: str, doc_type: str) -> int:
    import datetime

    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _lock, _connect() as conn:
        cur = conn.execute(
            "INSERT INTO documents (filename, file_hash, doc_type, status, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (filename, file_hash, doc_type, PENDING, now, now),
        )
        return int(cur.lastrowid)


def find_doc_by_hash(file_hash: str) -> dict | None:
    with _lock, _connect() as conn:
        row = conn.execute("SELECT * FROM documents WHERE file_hash = ?", (file_hash,)).fetchone()
        return dict(row) if row else None


def find_doc_by_text_hash(text_hash: str, exclude_id: int | None = None) -> dict | None:
    with _lock, _connect() as conn:
        if exclude_id is None:
            row = conn.execute("SELECT * FROM documents WHERE text_hash = ?", (text_hash,)).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM documents WHERE text_hash = ? AND id != ?", (text_hash, exclude_id)
            ).fetchone()
        return dict(row) if row else None


def update_doc_text_hash(doc_id: int, text_hash: str) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE documents SET text_hash = ?, updated_at = ? WHERE id = ?",
            (text_hash, datetime_now(), doc_id),
        )


def get_document(doc_id: int) -> dict | None:
    with _lock, _connect() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return dict(row) if row else None


def list_documents() -> list[dict]:
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM documents ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def update_doc_status(doc_id: int, status: str, error: str | None = None, chunk_count: int | None = None) -> None:
    import datetime

    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _lock, _connect() as conn:
        sets, args = ["status = ?", "updated_at = ?"], [status, now]
        if error is not None:
            sets.append("error = ?")
            args.append(error)
        if chunk_count is not None:
            sets.append("chunk_count = ?")
            args.append(chunk_count)
        args.append(doc_id)
        conn.execute(f"UPDATE documents SET {', '.join(sets)} WHERE id = ?", args)


def update_doc_progress(doc_id: int, progress: str) -> None:
    """Update human-readable progress hint (e.g. '解析中 3/10 页')."""
    import datetime

    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE documents SET progress = ?, updated_at = ? WHERE id = ?",
            (progress, now, doc_id),
        )


def update_doc_summary(doc_id: int, summary: str) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE documents SET summary = ?, updated_at = ? WHERE id = ?",
            (summary, datetime_now(), doc_id),
        )


def rename_document(doc_id: int, filename: str) -> bool:
    with _lock, _connect() as conn:
        cur = conn.execute(
            "UPDATE documents SET filename = ?, updated_at = ? WHERE id = ?",
            (filename, datetime_now(), doc_id),
        )
        return cur.rowcount > 0


def datetime_now() -> str:
    import datetime

    return datetime.datetime.now().isoformat(timespec="seconds")


def delete_document(doc_id: int) -> bool:
    with _lock, _connect() as conn:
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        cur = conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    # remove stored original file if any (doc_id.* glob)
    for f in FILES_DIR.glob(f"{doc_id}.*"):
        try:
            f.unlink()
        except OSError:
            pass
    return cur.rowcount > 0


# ---------- chunks ----------

def replace_chunks(doc_id: int, chunks: list[tuple[str, str | None, list[float]]]) -> None:
    """Delete old chunks and insert new ones. chunk = (content, source, embedding)."""
    with _lock, _connect() as conn:
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        conn.executemany(
            "INSERT INTO chunks (doc_id, idx, content, source, embedding) VALUES (?, ?, ?, ?, ?)",
            [
                (doc_id, i, content, source, json.dumps(emb, ensure_ascii=False))
                for i, (content, source, emb) in enumerate(chunks)
            ],
        )


def count_chunks(doc_id: int) -> int:
    with _lock, _connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS c FROM chunks WHERE doc_id = ?", (doc_id,)).fetchone()
        return int(row["c"])


def all_chunks() -> list[dict]:
    """Load all chunks with their document info for brute-force retrieval."""
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT c.id, c.doc_id, c.idx, c.content, c.source, c.embedding, d.filename, d.status"
            " FROM chunks c JOIN documents d ON d.id = c.doc_id"
            " WHERE d.status = ? AND c.embedding IS NOT NULL",
            (READY,),
        ).fetchall()
        return [dict(r) for r in rows]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)
