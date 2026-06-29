"""
SQLite storage + component-session tracker for RFID reads.

Tables (existing in database/rfid_reads.db):

  tag_reads          — accepted reads (filtered + throttled):
                       epc, antenna, rssi, read_at

  component_sessions — one row per pass:
                       entered_at    = first valid read on antenna 1
                       last_ant1_at  = last  valid read on antenna 1
                       first_ant2_at = first valid read on antenna 2
                       exited_at     = last  valid read on antenna 2
                       entry_rssi / last_ant1_rssi / first_ant2_rssi / exit_rssi
                       dwell_seconds = exited_at − entered_at  (INTEGER seconds)
                       status        = 'IN_PROGRESS' or 'COMPLETE'

Valid-read filter:
    RSSI must satisfy  RSSI_MIN <= rssi <= 0.   Default RSSI_MIN = -40.
    Reads with no RSSI are rejected.

Session close triggers:
    1. Same EPC is read on antenna 1 again AFTER any antenna-2 reads.
    2. Idle close: no new ant-2 read for IDLE_TIMEOUT_SEC.  Swept on every
       ingest call (no background thread).
"""

from __future__ import annotations

import re
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

# Add parent directory to path for config import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import (
    ENTRY_ANTENNA,
    EXIT_ANTENNA,
    RSSI_MIN,
    MIN_READS_FOR_SESSION,
    EPC_FILTER_PATTERN,
    STATUS_OPEN,
    STATUS_CLOSED,
    STATUS_ABANDONED,
    STATUS_EXIT_ONLY,
    RAW_THROTTLE_SEC,
    RAW_MAX_ROWS,
    PRUNE_EVERY_N_INSERTS,
    IDLE_TIMEOUT_SEC,
    SWEEP_INTERVAL_SEC,
    ABANDON_TIMEOUT_SEC,
    DB_PATH,
)

_DEFAULT_DB = DB_PATH


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_ts(value: str) -> Optional[datetime]:
    """Parse the reader's ISO timestamp like '2026-05-22T23:40:14.471+0000'."""
    if not value:
        return None
    v = value.strip()
    if len(v) >= 5 and (v[-5] in "+-") and v[-3] != ":":
        v = v[:-2] + ":" + v[-2:]
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _valid_rssi(rssi) -> bool:
    if rssi is None:
        return False
    try:
        r = int(rssi)
    except (TypeError, ValueError):
        return False
    return RSSI_MIN <= r <= 0


def _decode_epc(epc: str) -> str:
    try:
        return bytes.fromhex(epc).rstrip(b"\x00").decode("ascii", errors="replace")
    except Exception:
        return epc


def _epc_matches_filter(epc: str) -> bool:
    if not EPC_FILTER_PATTERN:
        return True
    return re.fullmatch(EPC_FILTER_PATTERN, _decode_epc(epc)) is not None


# ── Open session in-memory state ──────────────────────────────────────────────

class _Session:
    __slots__ = (
        "id", "epc",
        "first_ant1_ts", "first_ant1_rssi",
        "last_ant1_ts",  "last_ant1_rssi",
        "first_ant2_ts", "first_ant2_rssi",
        "last_ant2_ts",  "last_ant2_rssi",
        "last_seen_wall",
    )

    def __init__(self, sid: int, epc: str,
                 first_ant1_ts: Optional[datetime],
                 first_ant1_rssi: Optional[int],
                 last_seen_wall: Optional[datetime] = None):
        self.id = sid
        self.epc = epc
        self.first_ant1_ts:  Optional[datetime] = first_ant1_ts
        self.first_ant1_rssi: Optional[int]     = first_ant1_rssi
        self.last_ant1_ts:   Optional[datetime] = first_ant1_ts
        self.last_ant1_rssi: Optional[int]      = first_ant1_rssi
        self.first_ant2_ts:  Optional[datetime] = None
        self.first_ant2_rssi: Optional[int]     = None
        self.last_ant2_ts:   Optional[datetime] = None
        self.last_ant2_rssi: Optional[int]      = None
        self.last_seen_wall = last_seen_wall or datetime.now(timezone.utc)


# ── Tracker ───────────────────────────────────────────────────────────────────

class DwellTracker:
    def __init__(self, db_path: os.PathLike | str = _DEFAULT_DB):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            self.db_path, check_same_thread=False, isolation_level=None
        )
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._conn.execute("PRAGMA busy_timeout=5000;")

        self._ensure_columns()

        self._open: dict[str, _Session] = {}
        self._last_raw: dict[tuple[str, int], float] = {}
        self._read_counts: dict[tuple[str, int], int] = {}  # (epc, antenna) -> read count
        self._inserts_since_prune = 0

        self._recover_open_sessions()

        # Background sweeper: closes idle sessions even when no POSTs arrive.
        self._stop_evt = threading.Event()
        self._sweeper = threading.Thread(
            target=self._sweep_loop, name="dwell-sweeper", daemon=True
        )
        self._sweeper.start()

    # ── schema migration ──────────────────────────────────────────────────

    def _ensure_columns(self) -> None:
        """Migrate tag_reads to antenna-suffixed enter/exit columns.

        Target columns:
            first_enter_at_ant1, first_enter_rssi_ant1,
            last_enter_at_ant1,  last_enter_rssi_ant1,
            first_exit_at_ant2,  first_exit_rssi_ant2,
            last_exit_at_ant2,   last_exit_rssi_ant2
        """
        self._conn.executescript('''
            CREATE TABLE IF NOT EXISTS tag_reads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                "IBUS #" TEXT NOT NULL,
                dwell_seconds INTEGER,
                status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
                first_enter_at_ant1 TEXT,
                first_enter_rssi_ant1 INTEGER,
                last_enter_at_ant1 TEXT,
                last_enter_rssi_ant1 INTEGER,
                first_exit_at_ant2 TEXT,
                first_exit_rssi_ant2 INTEGER,
                last_exit_at_ant2 TEXT,
                last_exit_rssi_ant2 INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_reads_ibus ON tag_reads("IBUS #");
            CREATE INDEX IF NOT EXISTS idx_reads_status ON tag_reads(status);
        ''')
        target_columns = [
            ("first_enter_at_ant1",   "TEXT"),
            ("first_enter_rssi_ant1", "INTEGER"),
            ("last_enter_at_ant1",    "TEXT"),
            ("last_enter_rssi_ant1",  "INTEGER"),
            ("first_exit_at_ant2",    "TEXT"),
            ("first_exit_rssi_ant2",  "INTEGER"),
            ("last_exit_at_ant2",     "TEXT"),
            ("last_exit_rssi_ant2",   "INTEGER"),
        ]
        # All known historical names that should funnel into each target.
        # Order matters only for cosmetic priority; we COALESCE on the new
        # column being NULL so re-runs are no-ops.
        copy_pairs = [
            # current → target
            ("first_enter_at_ant1",   "first_enter_at"),
            ("first_enter_rssi_ant1", "first_enter_rssi"),
            ("last_enter_at_ant1",    "last_enter_at"),
            ("last_enter_rssi_ant1",  "last_enter_rssi"),
            ("first_exit_at_ant2",    "first_exit_at"),
            ("first_exit_rssi_ant2",  "first_exit_rssi"),
            ("last_exit_at_ant2",     "last_exit_at"),
            ("last_exit_rssi_ant2",   "last_exit_rssi"),
            # very old → target (in case someone upgrades from gen-1 schema)
            ("first_enter_at_ant1",   "entered_at"),
            ("first_enter_rssi_ant1", "entry_rssi"),
            ("last_enter_at_ant1",    "last_ant1_at"),
            ("last_enter_rssi_ant1",  "last_ant1_rssi"),
            ("first_exit_at_ant2",    "first_ant2_at"),
            ("first_exit_rssi_ant2",  "first_ant2_rssi"),
            ("last_exit_at_ant2",     "exited_at"),
            ("last_exit_rssi_ant2",   "exit_rssi"),
        ]
        legacy_columns_to_drop = [
            # gen-2 (the rename we just did)
            "first_enter_at", "first_enter_rssi",
            "last_enter_at",  "last_enter_rssi",
            "first_exit_at",  "first_exit_rssi",
            "last_exit_at",   "last_exit_rssi",
            "enter_antenna",  "exit_antenna",
            # gen-1
            "entered_at", "entry_rssi",
            "last_ant1_at", "last_ant1_rssi",
            "first_ant2_at", "first_ant2_rssi",
            "exited_at", "exit_rssi",
        ]

        with self._lock:
            cols = {row[1] for row in self._conn.execute(
                "PRAGMA table_info(tag_reads)"
            )}

            # 1. Add new columns if missing.
            for name, ddl in target_columns:
                if name not in cols:
                    self._conn.execute(
                        f"ALTER TABLE tag_reads "
                        f"ADD COLUMN {name} {ddl}"
                    )

            # Refresh column set after additions.
            cols = {row[1] for row in self._conn.execute(
                "PRAGMA table_info(tag_reads)"
            )}

            # 2. Copy data from any legacy column that still exists into its
            #    target counterpart (only where the target is NULL).
            for target_col, legacy_col in copy_pairs:
                if legacy_col in cols and target_col in cols:
                    self._conn.execute(
                        f"UPDATE tag_reads "
                        f"SET {target_col} = {legacy_col} "
                        f"WHERE {target_col} IS NULL "
                        f"  AND {legacy_col} IS NOT NULL"
                    )

            # 3. Drop legacy columns. SQLite >= 3.35 supports DROP COLUMN.
            for legacy_col in legacy_columns_to_drop:
                if legacy_col in cols:
                    try:
                        self._conn.execute(
                            f"ALTER TABLE tag_reads "
                            f"DROP COLUMN {legacy_col}"
                        )
                    except sqlite3.OperationalError:
                        pass

            self._conn.execute("DROP VIEW IF EXISTS component_sessions_display")

    # ── recovery ──────────────────────────────────────────────────────────

    def _recover_open_sessions(self) -> None:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, \"IBUS #\", "
                "       first_enter_at_ant1, first_enter_rssi_ant1, "
                "       last_enter_at_ant1,  last_enter_rssi_ant1, "
                "       first_exit_at_ant2,  first_exit_rssi_ant2, "
                "       last_exit_at_ant2,   last_exit_rssi_ant2 "
                "FROM tag_reads WHERE status IN (?, ?)",
                (STATUS_OPEN, STATUS_EXIT_ONLY),
            ).fetchall()

        for (sid, epc, entered_at, entry_rssi,
             last1_at, last1_rssi, first2_at, first2_rssi,
             last2_at, last2_rssi) in rows:
            entered_dt = _parse_ts(entered_at) if entered_at else None
            sess = _Session(sid, epc, entered_dt, entry_rssi)
            sess.last_ant1_ts    = _parse_ts(last1_at) if last1_at else entered_dt
            sess.last_ant1_rssi  = last1_rssi if last1_rssi is not None else entry_rssi
            sess.first_ant2_ts   = _parse_ts(first2_at) if first2_at else None
            sess.first_ant2_rssi = first2_rssi
            sess.last_ant2_ts    = _parse_ts(last2_at) if last2_at else None
            sess.last_ant2_rssi  = last2_rssi
            self._open[epc] = sess

    # ── public API ────────────────────────────────────────────────────────

    def ingest_batch(self, events: Iterable[dict]) -> dict:
        summary = {
            "raw_inserted":   0,
            "raw_throttled":  0,
            "raw_rejected":   0,   # failed RSSI filter
            "session_opened": 0,
            "session_closed": 0,
        }

        # Sort by reader timestamp for stable enter/exit pairing.
        ordered = []
        for ev in events or []:
            dt = _parse_ts(ev.get("timestamp", ""))
            if dt is None:
                dt = datetime.now(timezone.utc)
            ordered.append((dt, ev))
        ordered.sort(key=lambda x: x[0])

        # Strongest-signal-wins: within 100ms window, same EPC only keeps strongest read
        WINNER_WINDOW_SEC = 0.10
        epc_best: dict[str, tuple[datetime, dict, int]] = {}  # epc -> (dt, ev, rssi)
        for reader_dt, ev in ordered:
            data = ev.get("data") or {}
            epc = (data.get("idHex") or data.get("epc") or "").lower()
            if not epc:
                continue
            rssi = data.get("peakRssi")
            try:
                rssi_val = int(rssi)
            except (TypeError, ValueError):
                continue
            existing = epc_best.get(epc)
            if existing is None or (reader_dt - existing[0]).total_seconds() > WINNER_WINDOW_SEC:
                # New window or first read - start fresh
                epc_best[epc] = (reader_dt, ev, rssi_val)
            elif rssi_val > existing[2]:
                # Stronger signal within window - replace
                epc_best[epc] = (reader_dt, ev, rssi_val)
            # else: weaker signal - discard

        winners = [(dt, ev) for (dt, ev, _) in epc_best.values()]
        winners.sort(key=lambda x: x[0])

        with self._lock:
            for reader_dt, ev in winners:
                data = ev.get("data") or {}
                epc_hex = (data.get("idHex") or data.get("epc") or "").lower()
                if not epc_hex:
                    continue

                if not _epc_matches_filter(epc_hex):
                    continue
                epc = _decode_epc(epc_hex)

                antenna = int(data.get("antenna") or 0)
                if antenna == 0:
                    continue

                rssi = data.get("peakRssi")
                if not _valid_rssi(rssi):
                    summary["raw_rejected"] += 1
                    continue
                rssi = int(rssi)
                reader_iso = reader_dt.isoformat()

                key = (epc, antenna)
                now_epoch = reader_dt.timestamp()
                last = self._last_raw.get(key, 0.0)
                new_window = now_epoch - last >= RAW_THROTTLE_SEC
                if new_window:
                    self._last_raw[key] = now_epoch
                    summary["raw_inserted"] += 1
                    self._read_counts[key] = 1
                else:
                    summary["raw_throttled"] += 1
                    self._read_counts[key] = self._read_counts.get(key, 0) + 1

                # session bookkeeping
                if antenna == ENTRY_ANTENNA:
                    sess = self._open.get(epc)
                    # If a previous pass already saw antenna 2, close it before
                    # starting a new pass.
                    if sess is not None and sess.last_ant2_ts is not None:
                        self._finalize(sess)
                        summary["session_closed"] += 1
                        sess = None

                    if sess is None:
                        # Temporal filter: require sustained reads before opening session
                        read_count = self._read_counts.get((epc, antenna), 0)
                        if read_count < MIN_READS_FOR_SESSION:
                            # Not enough sustained reads - skip session creation
                            continue
                        cur = self._conn.execute(
                            "INSERT INTO tag_reads "
                            "(\"IBUS #\", first_enter_at_ant1, first_enter_rssi_ant1, "
                            " last_enter_at_ant1, last_enter_rssi_ant1, "
                            " status) "
                            "VALUES (?, ?, ?, ?, ?, ?)",
                            (epc, reader_iso, rssi, reader_iso, rssi,
                             STATUS_OPEN),
                        )
                        new_sess = _Session(cur.lastrowid, epc, reader_dt, rssi)
                        self._open[epc] = new_sess
                        summary["session_opened"] += 1
                    else:
                        sess.last_ant1_ts   = reader_dt
                        sess.last_ant1_rssi = rssi
                        sess.last_seen_wall = datetime.now(timezone.utc)
                        self._conn.execute(
                            "UPDATE tag_reads "
                            "SET last_enter_at_ant1 = ?, "
                            "    last_enter_rssi_ant1 = ? "
                            "WHERE id = ?",
                            (reader_iso, rssi, sess.id),
                        )

                elif antenna == EXIT_ANTENNA:
                    sess = self._open.get(epc)

                    # Ant-2 read with no open session — ignore.
                    if sess is None:
                        continue

                    # Reject ant-2 reads earlier than the recorded entry.
                    if (sess.first_ant1_ts is not None
                            and reader_dt < sess.first_ant1_ts):
                        continue

                    # First antenna-2 read: immediately close the session.
                    # Dwell = first_exit_at_ant2 - first_enter_at_ant1.
                    if sess.first_ant2_ts is None:
                        sess.first_ant2_ts   = reader_dt
                        sess.first_ant2_rssi = rssi
                        sess.last_ant2_ts    = reader_dt
                        sess.last_ant2_rssi  = rssi

                        if sess.first_ant1_ts is not None:
                            dwell = int(round(
                                (reader_dt - sess.first_ant1_ts).total_seconds()
                            ))
                            self._conn.execute(
                                "UPDATE tag_reads "
                                "SET first_exit_at_ant2 = ?, first_exit_rssi_ant2 = ?, "
                                "    last_exit_at_ant2  = ?, last_exit_rssi_ant2  = ?, "
                                "    dwell_seconds = ?, status = ? "
                                "WHERE id = ?",
                                (reader_iso, rssi, reader_iso, rssi,
                                 dwell, STATUS_CLOSED, sess.id),
                            )
                        else:
                            # EXIT_ONLY: antenna 2 seen before antenna 1.
                            self._conn.execute(
                                "UPDATE tag_reads "
                                "SET first_exit_at_ant2 = ?, first_exit_rssi_ant2 = ?, "
                                "    last_exit_at_ant2  = ?, last_exit_rssi_ant2  = ?, "
                                "    status = ? "
                                "WHERE id = ?",
                                (reader_iso, rssi, reader_iso, rssi,
                                 STATUS_EXIT_ONLY, sess.id),
                            )
                        self._open.pop(epc, None)
                        summary["session_closed"] += 1
                    # Subsequent ant-2 reads after close: session already popped,
                    # so self._open.get(epc) would have returned None above.

            if self._inserts_since_prune >= PRUNE_EVERY_N_INSERTS:
                pass
                self._inserts_since_prune = 0

        return summary

    def open_session_count(self) -> int:
        with self._lock:
            return len(self._open)

    def close(self) -> None:
        self._stop_evt.set()
        try:
            self._sweeper.join(timeout=2.0)
        except RuntimeError:
            pass
        with self._lock:
            self._conn.close()

    # ── background sweeper ────────────────────────────────────────────────

    def _sweep_loop(self) -> None:
        while not self._stop_evt.wait(SWEEP_INTERVAL_SEC):
            try:
                self._sweep_once()
            except Exception as exc:
                # Never let the sweeper die silently; keep going.
                print(f"[dwell-sweeper] error: {exc}")

    def _sweep_once(self) -> None:
        now = datetime.now(timezone.utc)
        with self._lock:
            for epc in list(self._open.keys()):
                sess = self._open[epc]
                idle = (now - sess.last_seen_wall).total_seconds()
                if idle < IDLE_TIMEOUT_SEC:
                    continue

                if sess.first_ant1_ts is None:
                    # EXIT_ONLY: idle close keeps the EXIT_ONLY status.
                    self._finalize(sess, status=STATUS_EXIT_ONLY)
                elif sess.last_ant2_ts is not None:
                    self._finalize(sess, status=STATUS_CLOSED)
                elif idle >= ABANDON_TIMEOUT_SEC:
                    self._finalize(sess, status=STATUS_ABANDONED)

    # ── internal ──────────────────────────────────────────────────────────

    def _finalize(self, sess: _Session, status: str = STATUS_CLOSED) -> None:
        """Set a session's final status and drop from in-memory map."""
        if (sess.first_ant2_ts is not None
                and sess.first_ant1_ts is not None):
            # Full pass: dwell = first exit - first entrance.
            dwell = int(round(
                (sess.first_ant2_ts - sess.first_ant1_ts).total_seconds()
            ))
            self._conn.execute(
                "UPDATE tag_reads "
                "SET last_exit_at_ant2 = ?, last_exit_rssi_ant2 = ?, "
                "    dwell_seconds = ?, status = ? "
                "WHERE id = ?",
                (
                    sess.last_ant2_ts.isoformat(),
                    sess.last_ant2_rssi,
                    dwell,
                    status,
                    sess.id,
                ),
            )
        elif sess.last_ant2_ts is not None:
            # EXIT_ONLY: no entry timestamp, no dwell. Just refresh exit cols
            # and stamp the final status.
            self._conn.execute(
                "UPDATE tag_reads "
                "SET last_exit_at_ant2 = ?, last_exit_rssi_ant2 = ?, "
                "    status = ? "
                "WHERE id = ?",
                (
                    sess.last_ant2_ts.isoformat(),
                    sess.last_ant2_rssi,
                    status,
                    sess.id,
                ),
            )
        else:
            # ABANDONED: only ant-1 ever seen.
            self._conn.execute(
                "UPDATE tag_reads SET status = ? WHERE id = ?",
                (status, sess.id),
            )
        self._open.pop(sess.epc, None)

    def _prune_raw(self) -> None:
        self._conn.execute(
            "SELECT 1",
            (),
        )
