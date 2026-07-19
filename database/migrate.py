"""
database/migrate.py
Versioned schema migration runner for the RFID tracking database.

Implements the normalized POC schema from Database.md (SQLite dialect):

  Core (9):
    rfid_tags, parts, part_tag_assignments,
    stations, rfid_readers, rfid_antennas,
    rfid_raw_reads, part_station_events, part_station_sessions

  Operators (3, tables only for now):
    operators, operator_station_presence, part_operator_assignments

  Plus view vw_live_part_status and all recommended indexes.

Both storage.py (DwellTracker) and api.py call run_migrations(conn, ...) on
startup. Migrations are numbered, each runs exactly once, and every migration
is idempotent so concurrent startups are safe.

Adding a new migration:
  1. Write a _mNNN_description(conn, **kwargs) function.
  2. Append (NNN, "description", _mNNN_description) to _MIGRATIONS.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

_UTC_NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"

# Default station catalog (Database.md section 12)
_DEFAULT_STATIONS = [
    ("Gannomat",       "Drilling"),
    ("Tennoner",       "Cutting"),
    ("Insert Station", "Assembly"),
    ("Anderson",       "Machining"),
    ("Final Packing",  "Packing"),
    ("LBD",            "Machining"),
]


# ── Core schema ───────────────────────────────────────────────────────────────

def _m001_core_tables(conn: sqlite3.Connection, **_) -> None:
    """Create the 9 core POC tables."""
    conn.executescript(f"""
        CREATE TABLE IF NOT EXISTS rfid_tags (
            tag_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            epc         TEXT NOT NULL UNIQUE,
            tid         TEXT,
            tag_status  TEXT NOT NULL DEFAULT 'active',
            created_at  TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );

        CREATE TABLE IF NOT EXISTS parts (
            part_id            INTEGER PRIMARY KEY AUTOINCREMENT,
            part_number        TEXT,
            part_name          TEXT,
            part_type          TEXT,
            ibus_number        TEXT,
            job_number         TEXT,
            quantity_required  INTEGER,
            created_at         TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );

        CREATE TABLE IF NOT EXISTS part_tag_assignments (
            assignment_id  INTEGER PRIMARY KEY AUTOINCREMENT,
            part_id        INTEGER NOT NULL REFERENCES parts(part_id),
            tag_id         INTEGER NOT NULL REFERENCES rfid_tags(tag_id),
            assigned_at    TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            unassigned_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS stations (
            station_id    INTEGER PRIMARY KEY AUTOINCREMENT,
            station_name  TEXT NOT NULL UNIQUE,
            station_type  TEXT,
            is_active     INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS rfid_readers (
            reader_id             INTEGER PRIMARY KEY AUTOINCREMENT,
            reader_name           TEXT NOT NULL,
            reader_ip             TEXT,
            station_id            INTEGER REFERENCES stations(station_id),
            location_description  TEXT,
            is_active             INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS rfid_antennas (
            antenna_id    INTEGER PRIMARY KEY AUTOINCREMENT,
            reader_id     INTEGER NOT NULL REFERENCES rfid_readers(reader_id),
            antenna_port  INTEGER NOT NULL,
            antenna_name  TEXT,
            antenna_role  TEXT,
            station_id    INTEGER REFERENCES stations(station_id)
        );

        CREATE TABLE IF NOT EXISTS rfid_raw_reads (
            read_id             INTEGER PRIMARY KEY AUTOINCREMENT,
            tag_id              INTEGER REFERENCES rfid_tags(tag_id),
            epc                 TEXT NOT NULL,
            reader_id           INTEGER REFERENCES rfid_readers(reader_id),
            antenna_id          INTEGER REFERENCES rfid_antennas(antenna_id),
            antenna_port        INTEGER,
            rssi                REAL,
            reader_timestamp    TEXT,
            server_received_at  TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            raw_payload         TEXT,
            read_status         TEXT DEFAULT 'valid',
            is_stale            INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS part_station_events (
            event_id          INTEGER PRIMARY KEY AUTOINCREMENT,
            part_id           INTEGER REFERENCES parts(part_id),
            tag_id            INTEGER NOT NULL REFERENCES rfid_tags(tag_id),
            station_id        INTEGER NOT NULL REFERENCES stations(station_id),
            event_type        TEXT NOT NULL,
            event_time        TEXT NOT NULL,
            source_read_id    INTEGER REFERENCES rfid_raw_reads(read_id),
            confidence_score  REAL,
            created_at        TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );

        CREATE TABLE IF NOT EXISTS part_station_sessions (
            session_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            part_id         INTEGER REFERENCES parts(part_id),
            tag_id          INTEGER NOT NULL REFERENCES rfid_tags(tag_id),
            station_id      INTEGER NOT NULL REFERENCES stations(station_id),
            entry_event_id  INTEGER REFERENCES part_station_events(event_id),
            exit_event_id   INTEGER REFERENCES part_station_events(event_id),
            entry_time      TEXT,
            exit_time       TEXT,
            dwell_seconds   INTEGER,
            session_status  TEXT NOT NULL DEFAULT 'open',
            created_at      TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            updated_at      TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );
    """)


def _m002_operator_tables(conn: sqlite3.Connection, **_) -> None:
    """Create the 3 operator tables (Database.md section 6). Tables only."""
    conn.executescript(f"""
        CREATE TABLE IF NOT EXISTS operators (
            operator_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_number  TEXT,
            operator_name    TEXT,
            rtls_badge_id    TEXT,
            is_active        INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS operator_station_presence (
            presence_id       INTEGER PRIMARY KEY AUTOINCREMENT,
            operator_id       INTEGER NOT NULL REFERENCES operators(operator_id),
            station_id        INTEGER NOT NULL REFERENCES stations(station_id),
            detected_at       TEXT NOT NULL,
            distance_meters   REAL,
            confidence_score  REAL
        );

        CREATE TABLE IF NOT EXISTS part_operator_assignments (
            assignment_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id         INTEGER NOT NULL REFERENCES part_station_sessions(session_id),
            operator_id        INTEGER NOT NULL REFERENCES operators(operator_id),
            assignment_method  TEXT NOT NULL,
            confidence_score   REAL,
            assigned_at        TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );
    """)


def _m003_indexes(conn: sqlite3.Connection, **_) -> None:
    """Create recommended indexes (Database.md sections 5.7 and 13.3)."""
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS IX_raw_reads_epc_time
            ON rfid_raw_reads (epc, reader_timestamp);
        CREATE INDEX IF NOT EXISTS IX_raw_reads_reader_time
            ON rfid_raw_reads (reader_id, reader_timestamp);
        CREATE INDEX IF NOT EXISTS IX_raw_reads_antenna_time
            ON rfid_raw_reads (antenna_id, reader_timestamp);
        CREATE INDEX IF NOT EXISTS IX_sessions_tag_station_status
            ON part_station_sessions (tag_id, station_id, session_status);
        CREATE INDEX IF NOT EXISTS IX_events_tag_station_time
            ON part_station_events (tag_id, station_id, event_time);
        CREATE INDEX IF NOT EXISTS IX_tags_epc
            ON rfid_tags (epc);
        CREATE INDEX IF NOT EXISTS IX_assignments_tag
            ON part_tag_assignments (tag_id);
        CREATE INDEX IF NOT EXISTS IX_presence_operator_time
            ON operator_station_presence (operator_id, detected_at);
        CREATE INDEX IF NOT EXISTS IX_part_operator_session
            ON part_operator_assignments (session_id);
    """)


def _m004_live_view(conn: sqlite3.Connection, **_) -> None:
    """Create the live dashboard view (Database.md section 8)."""
    conn.executescript("""
        DROP VIEW IF EXISTS vw_live_part_status;
        CREATE VIEW vw_live_part_status AS
        SELECT
            s.session_id,
            p.part_id,
            p.part_name,
            p.part_type,
            p.part_number,
            p.ibus_number,
            p.job_number,
            t.epc,
            st.station_name,
            s.entry_time,
            s.exit_time,
            s.dwell_seconds,
            s.session_status
        FROM part_station_sessions s
        JOIN rfid_tags t   ON s.tag_id     = t.tag_id
        LEFT JOIN parts p  ON s.part_id    = p.part_id
        JOIN stations st   ON s.station_id = st.station_id;
    """)


def _m005_seed_stations(conn: sqlite3.Connection, **_) -> None:
    """Seed the default station catalog."""
    for name, stype in _DEFAULT_STATIONS:
        conn.execute(
            "INSERT OR IGNORE INTO stations (station_name, station_type) VALUES (?, ?)",
            (name, stype),
        )


def _m006_seed_reader_and_antennas(
    conn: sqlite3.Connection,
    station_name: str = "Gannomat",
    station_type: str = "Drilling",
    station_location: str = "",
    reader_name: str = "FX9600-Gannomat",
    reader_ip: str = "",
    entry_antenna: int = 1,
    exit_antenna: int = 2,
    **_,
) -> None:
    """Seed this machine's reader + its Entry/Exit antennas, bound to its station."""
    # Ensure the station exists (covers custom station names not in the catalog).
    conn.execute(
        "INSERT OR IGNORE INTO stations (station_name, station_type) VALUES (?, ?)",
        (station_name, station_type),
    )
    st = conn.execute(
        "SELECT station_id FROM stations WHERE station_name = ?", (station_name,)
    ).fetchone()
    station_id = st[0] if st else None

    location_desc = (
        f"{station_location} - {station_name} entrance/exit RFID reader"
        if station_location
        else f"{station_name} entrance/exit RFID reader"
    )

    reader = conn.execute(
        "SELECT reader_id FROM rfid_readers WHERE reader_name = ?", (reader_name,)
    ).fetchone()
    if reader:
        reader_id = reader[0]
    else:
        cur = conn.execute(
            "INSERT INTO rfid_readers (reader_name, reader_ip, station_id, location_description) "
            "VALUES (?, ?, ?, ?)",
            (reader_name, reader_ip or None, station_id, location_desc),
        )
        reader_id = cur.lastrowid

    antennas = [
        (entry_antenna, f"{station_name} Entry Antenna", "Entry"),
        (exit_antenna,  f"{station_name} Exit Antenna",  "Exit"),
    ]
    for port, aname, role in antennas:
        exists = conn.execute(
            "SELECT antenna_id FROM rfid_antennas WHERE reader_id = ? AND antenna_port = ?",
            (reader_id, port),
        ).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO rfid_antennas (reader_id, antenna_port, antenna_name, antenna_role, station_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (reader_id, port, aname, role, station_id),
            )


def _m007_seed_operators(conn: sqlite3.Connection, **_) -> None:
    """Seed operators from RTLS/operator-names.json (Sewio feed ID -> name)."""
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "RTLS" / "operator-names.json"
    if not path.exists():
        return

    data = json.loads(path.read_text(encoding="utf-8"))
    for badge_id, name in data.items():
        if str(badge_id).startswith("_"):
            continue
        exists = conn.execute(
            "SELECT operator_id FROM operators WHERE rtls_badge_id = ?",
            (str(badge_id),),
        ).fetchone()
        if exists:
            conn.execute(
                "UPDATE operators SET operator_name = ?, is_active = 1 WHERE rtls_badge_id = ?",
                (name, str(badge_id)),
            )
        else:
            conn.execute(
                "INSERT INTO operators (employee_number, operator_name, rtls_badge_id, is_active) "
                "VALUES (?, ?, ?, 1)",
                (str(badge_id), name, str(badge_id)),
            )


def _m008_seed_insert_antenna(
    conn: sqlite3.Connection,
    reader_name: str = "FX9600-Gannomat",
    third_antenna: int = 3,
    insert_station_name: str = "Insert Station",
    **_,
) -> None:
    """Seed antenna 3 on the Gannomat reader as Insert Station entry."""
    conn.execute(
        "INSERT OR IGNORE INTO stations (station_name, station_type) VALUES (?, ?)",
        (insert_station_name, "Assembly"),
    )
    row = conn.execute(
        "SELECT station_id FROM stations WHERE station_name = ?", (insert_station_name,)
    ).fetchone()
    if not row:
        return
    insert_station_id = row[0]

    reader = conn.execute(
        "SELECT reader_id FROM rfid_readers WHERE reader_name = ?", (reader_name,)
    ).fetchone()
    if not reader:
        return
    reader_id = reader[0]

    exists = conn.execute(
        "SELECT antenna_id FROM rfid_antennas WHERE reader_id = ? AND antenna_port = ?",
        (reader_id, third_antenna),
    ).fetchone()
    if not exists:
        conn.execute(
            "INSERT INTO rfid_antennas (reader_id, antenna_port, antenna_name, antenna_role, station_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                reader_id,
                third_antenna,
                f"{insert_station_name} Entry Antenna",
                "Entry",
                insert_station_id,
            ),
        )


def _m009_operator_current_zone(conn: sqlite3.Connection, **_) -> None:
    """Track each operator's latest zone in/out for session assignment."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS operator_current_zone (
            operator_id   INTEGER PRIMARY KEY REFERENCES operators(operator_id),
            zone_id       INTEGER NOT NULL,
            station_name  TEXT,
            zone_name     TEXT,
            status        TEXT NOT NULL CHECK (status IN ('in', 'out')),
            updated_at    TEXT NOT NULL
        )
    """)


def _m010_session_operator_presence(conn: sqlite3.Connection, **_) -> None:
    """Track live operator presence at a part session; confirm after dwell threshold."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS session_operator_presence (
            presence_id   INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id    INTEGER NOT NULL REFERENCES part_station_sessions(session_id),
            operator_id   INTEGER NOT NULL REFERENCES operators(operator_id),
            station_id    INTEGER NOT NULL REFERENCES stations(station_id),
            entered_at    TEXT NOT NULL,
            confirmed_at  TEXT,
            left_at       TEXT
        );
        CREATE INDEX IF NOT EXISTS IX_session_op_presence_session
            ON session_operator_presence (session_id, left_at);
        CREATE INDEX IF NOT EXISTS IX_session_op_presence_active
            ON session_operator_presence (session_id, operator_id)
            WHERE left_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS UX_session_op_presence_active
            ON session_operator_presence (session_id, operator_id)
            WHERE left_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS UX_part_operator_session_op
            ON part_operator_assignments (session_id, operator_id);
    """)


def _m011_assignment_zone_snapshot(conn: sqlite3.Connection, **_) -> None:
    """Store zone/station at confirmation time (not operator's current location)."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(part_operator_assignments)")}
    for col, typ in (
        ("zone_id", "INTEGER"),
        ("zone_name", "TEXT"),
        ("station_name", "TEXT"),
    ):
        if col not in cols:
            conn.execute(f"ALTER TABLE part_operator_assignments ADD COLUMN {col} {typ}")


def _m012_seed_line_antennas(
    conn: sqlite3.Connection,
    reader_name: str = "FX9600-Gannomat",
    **_,
) -> None:
    """Seed LBD + Tennoner antennas 4–7 on the shared FX9600 reader."""
    # Local import avoids a circular import at module load (config → migrate).
    from config import ANTENNA_CATALOG

    extra_ports = (4, 5, 6, 7)
    for port in extra_ports:
        name, role, station_name, station_type = ANTENNA_CATALOG[port]
        conn.execute(
            "INSERT OR IGNORE INTO stations (station_name, station_type) VALUES (?, ?)",
            (station_name, station_type),
        )

    reader = conn.execute(
        "SELECT reader_id FROM rfid_readers WHERE reader_name = ?", (reader_name,)
    ).fetchone()
    if not reader:
        return
    reader_id = reader[0]

    for port in extra_ports:
        name, role, station_name, _station_type = ANTENNA_CATALOG[port]
        st = conn.execute(
            "SELECT station_id FROM stations WHERE station_name = ?", (station_name,)
        ).fetchone()
        if not st:
            continue
        exists = conn.execute(
            "SELECT antenna_id FROM rfid_antennas WHERE reader_id = ? AND antenna_port = ?",
            (reader_id, port),
        ).fetchone()
        if exists:
            continue
        conn.execute(
            "INSERT INTO rfid_antennas (reader_id, antenna_port, antenna_name, antenna_role, station_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (reader_id, port, name, role, st[0]),
        )


def _m014_operator_zone_visits(conn: sqlite3.Connection, **_) -> None:
    """Historical operator zone dwell for analytics over time."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS operator_zone_visits (
            visit_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            operator_id   INTEGER NOT NULL REFERENCES operators(operator_id),
            tag_id        INTEGER,
            zone_id       INTEGER NOT NULL,
            station_name  TEXT,
            zone_name     TEXT,
            entered_at    TEXT NOT NULL,
            exited_at     TEXT,
            dwell_seconds INTEGER,
            source        TEXT NOT NULL DEFAULT 'rtls'
        );
        CREATE INDEX IF NOT EXISTS IX_op_zone_visits_operator
            ON operator_zone_visits (operator_id, entered_at DESC);
        CREATE INDEX IF NOT EXISTS IX_op_zone_visits_station
            ON operator_zone_visits (station_name, entered_at DESC);
        CREATE INDEX IF NOT EXISTS IX_op_zone_visits_open
            ON operator_zone_visits (operator_id)
            WHERE exited_at IS NULL;
    """)


def _m013_work_order_bom(conn: sqlite3.Connection, **_) -> None:
    """Cut Rite / R41 work orders and expected component BOM lines."""
    conn.executescript(f"""
        CREATE TABLE IF NOT EXISTS work_orders (
            work_order_id   INTEGER PRIMARY KEY AUTOINCREMENT,
            ibus_number     TEXT NOT NULL UNIQUE,
            work_order      TEXT,
            customer        TEXT,
            job_site        TEXT,
            prod_date       TEXT,
            project_id      TEXT,
            source_file     TEXT,
            parts_count     INTEGER NOT NULL DEFAULT 0,
            pieces_count    INTEGER NOT NULL DEFAULT 0,
            status          TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'closed', 'cancelled')),
            ingested_at     TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            created_at      TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            updated_at      TEXT NOT NULL DEFAULT ({_UTC_NOW})
        );

        CREATE TABLE IF NOT EXISTS work_order_components (
            component_id     INTEGER PRIMARY KEY AUTOINCREMENT,
            work_order_id    INTEGER NOT NULL REFERENCES work_orders(work_order_id) ON DELETE CASCADE,
            line_index       INTEGER NOT NULL,
            ref              TEXT,
            qty              INTEGER NOT NULL DEFAULT 1,
            epc              TEXT,
            tag_label        TEXT,
            part_id          INTEGER REFERENCES parts(part_id),
            tag_id           INTEGER REFERENCES rfid_tags(tag_id),
            size             TEXT,
            room             TEXT,
            operation        TEXT,
            product          TEXT,
            material_family  TEXT,
            color            TEXT,
            length_cut       TEXT,
            width_cut        TEXT,
            part_erp_id      TEXT,
            job_number       TEXT,
            po               TEXT,
            drawing          TEXT,
            bem              TEXT,
            bem2             TEXT,
            bem3             TEXT,
            status           TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'in_process', 'complete')),
            created_at       TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            updated_at       TEXT NOT NULL DEFAULT ({_UTC_NOW}),
            UNIQUE (work_order_id, line_index)
        );

        CREATE INDEX IF NOT EXISTS IX_woc_work_order
            ON work_order_components (work_order_id);
        CREATE INDEX IF NOT EXISTS IX_woc_epc
            ON work_order_components (epc);
        CREATE INDEX IF NOT EXISTS IX_woc_ref
            ON work_order_components (ref);
        CREATE UNIQUE INDEX IF NOT EXISTS UX_woc_epc_nonnull
            ON work_order_components (epc) WHERE epc IS NOT NULL AND epc != '';
    """)


def _m015_station_specifications(conn: sqlite3.Connection, **_) -> None:
    """Per-machine analytics targets (dwell benchmarks, progress weights)."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS station_specifications (
            station_id                    INTEGER PRIMARY KEY
                REFERENCES stations(station_id) ON DELETE CASCADE,
            target_part_dwell_seconds       INTEGER,
            target_operator_dwell_seconds   INTEGER,
            max_dwell_seconds               INTEGER,
            target_pieces_per_hour          REAL,
            progress_spine_index            INTEGER,
            on_progress_spine               INTEGER NOT NULL DEFAULT 0,
            notes                           TEXT,
            updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS IX_station_specs_spine
            ON station_specifications (on_progress_spine, progress_spine_index);
    """)

    # Local import — migrate runs before full app wiring.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tracking"))
    from station_specs import default_seed_for_station  # noqa: WPS433

    rows = conn.execute(
        "SELECT station_id, station_name FROM stations WHERE is_active = 1"
    ).fetchall()
    for station_id, station_name in rows:
        exists = conn.execute(
            "SELECT 1 FROM station_specifications WHERE station_id = ?",
            (station_id,),
        ).fetchone()
        if exists:
            continue
        seed = default_seed_for_station(station_name)
        conn.execute(
            """INSERT INTO station_specifications
               (station_id, target_part_dwell_seconds, target_operator_dwell_seconds,
                max_dwell_seconds, target_pieces_per_hour, progress_spine_index,
                on_progress_spine, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (
                station_id,
                seed.get("target_part_dwell_seconds"),
                seed.get("target_operator_dwell_seconds"),
                seed.get("max_dwell_seconds"),
                seed.get("target_pieces_per_hour"),
                seed.get("progress_spine_index"),
                seed.get("on_progress_spine", 0),
            ),
        )


def _m016_tenoner_return_count(conn: sqlite3.Connection, **_) -> None:
    """Count Tennoner return trips (ant 7 after ant 4/5) on each part."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(parts)")}
    if "tenoner_return_count" not in cols:
        conn.execute(
            "ALTER TABLE parts ADD COLUMN tenoner_return_count "
            "INTEGER NOT NULL DEFAULT 0"
        )
    # Refresh live view so dashboard/API can read the counter.
    conn.executescript("""
        DROP VIEW IF EXISTS vw_live_part_status;
        CREATE VIEW vw_live_part_status AS
        SELECT
            s.session_id,
            p.part_id,
            p.part_name,
            p.part_type,
            p.part_number,
            p.ibus_number,
            p.job_number,
            p.tenoner_return_count,
            t.epc,
            st.station_name,
            s.entry_time,
            s.exit_time,
            s.dwell_seconds,
            s.session_status
        FROM part_station_sessions s
        JOIN rfid_tags t   ON s.tag_id     = t.tag_id
        LEFT JOIN parts p  ON s.part_id    = p.part_id
        JOIN stations st   ON s.station_id = st.station_id;
    """)


# ── Migration registry ────────────────────────────────────────────────────────

_MIGRATIONS: list[tuple[int, str, object]] = [
    (1, "core_tables",              _m001_core_tables),
    (2, "operator_tables",          _m002_operator_tables),
    (3, "indexes",                  _m003_indexes),
    (4, "live_view",                _m004_live_view),
    (5, "seed_stations",            _m005_seed_stations),
    (6, "seed_reader_and_antennas", _m006_seed_reader_and_antennas),
    (7, "seed_operators",            _m007_seed_operators),
    (8, "seed_insert_antenna",      _m008_seed_insert_antenna),
    (9, "operator_current_zone",    _m009_operator_current_zone),
    (10, "session_operator_presence", _m010_session_operator_presence),
    (11, "assignment_zone_snapshot", _m011_assignment_zone_snapshot),
    (12, "seed_line_antennas",      _m012_seed_line_antennas),
    (13, "work_order_bom",          _m013_work_order_bom),
    (14, "operator_zone_visits",    _m014_operator_zone_visits),
    (15, "station_specifications",  _m015_station_specifications),
    (16, "tenoner_return_count",    _m016_tenoner_return_count),
]


# ── Public entrypoint ─────────────────────────────────────────────────────────

def run_migrations(
    conn: sqlite3.Connection,
    station_name: str = "Gannomat",
    station_type: str = "Drilling",
    station_location: str = "",
    reader_name: str = "FX9600-Gannomat",
    reader_ip: str = "",
    entry_antenna: int = 1,
    exit_antenna: int = 2,
    third_antenna: int = 3,
    insert_station_name: str = "Insert Station",
) -> None:
    """
    Run all pending migrations against `conn` in order.
    Safe to call on every process startup - already-applied migrations are skipped.
    """
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT ({_UTC_NOW})
        )
    """)

    applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}

    kwargs = {
        "station_name":     station_name,
        "station_type":     station_type,
        "station_location": station_location,
        "reader_name":      reader_name,
        "reader_ip":        reader_ip,
        "entry_antenna":    entry_antenna,
        "exit_antenna":     exit_antenna,
        "third_antenna":    third_antenna,
        "insert_station_name": insert_station_name,
    }

    for version, name, fn in _MIGRATIONS:
        if version in applied:
            continue
        fn(conn, **kwargs)
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)",
            (version, name),
        )

    try:
        conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
    except Exception:
        pass
