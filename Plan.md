# Live Frontend Dashboard and WebSocket Requirement

## Purpose

Build a live frontend dashboard for the RFID Gannomat POC.

The dashboard should show the current live status of parts moving through the Gannomat station. It should update automatically as RFID reads are received from the entrance and exit antennas. The user should not need to refresh the page.

The frontend should display processed station-session data, not raw RFID reads. Raw RFID reads should be stored in the database first, then backend logic should create or update a station session, calculate dwell time, create alerts if needed, and push the updated station status to the frontend through a WebSocket.

---

## Main Dashboard Goal

The dashboard should answer these questions in real time:

1. What parts are currently inside the Gannomat?
2. What parts recently completed the Gannomat process?
3. When did each part enter?
4. When did each part exit?
5. How long was each part at the station?
6. Which operator was associated with the part?
7. Are there any issues or alerts?
8. Is the RFID reader connected and actively sending reads?

---

## Required Dashboard Pages

For the POC, build one main page:

```text
/gannomat-dashboard
```

The page title should be:

```text
RFID Gannomat Live Dashboard
```

This page should include:

1. Header section
2. System status cards
3. Live Gannomat queue table
4. Recently completed sessions table
5. Active alerts panel
6. Recent RFID reads panel
7. WebSocket connection indicator

---

# 1. Header Section

At the top of the dashboard, show:

```text
RFID Gannomat Live Dashboard
```

Under the title, show a small subtitle:

```text
Live part tracking, dwell time, and operator association for the Gannomat station.
```

Also show the current date/time on the right side of the header.

Example:

```text
RFID Gannomat Live Dashboard                         Last Updated: 9:42:18 AM
Live part tracking, dwell time, and operator association for the Gannomat station.
```

The `Last Updated` time should update whenever new dashboard data is received from the WebSocket.

---

# 2. WebSocket Connection Indicator

The dashboard must clearly show whether the live connection is active.

Add a small status indicator in the top-right area.

Possible statuses:

| Status       | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| Live         | WebSocket is connected                                     |
| Reconnecting | WebSocket disconnected and frontend is trying to reconnect |
| Offline      | WebSocket is disconnected                                  |
| Error        | WebSocket connection failed                                |

Display example:

```text
Live Connection: Online
```

Use a colored dot next to the status:

```text
Green = Live
Yellow = Reconnecting
Red = Offline/Error
```

If the WebSocket disconnects, the frontend should automatically try to reconnect every 3 seconds.

---

# 3. System Status Cards

Below the header, show summary cards.

Required cards:

## Card 1: Parts In Process

Shows the number of station sessions where:

```text
status = In Process
```

Example:

```text
Parts In Process
3
```

## Card 2: Completed Today

Shows the number of sessions completed today where:

```text
status = Completed
exit_time is today
```

Example:

```text
Completed Today
42
```

## Card 3: Average Dwell Time Today

Shows the average dwell time for completed sessions today.

Example:

```text
Average Dwell Time
14 min 22 sec
```

## Card 4: Active Alerts

Shows the count of open alerts.

Example:

```text
Active Alerts
2
```

## Card 5: Last RFID Read

Shows the most recent RFID read time.

Example:

```text
Last RFID Read
9:41:55 AM
```

## Card 6: Reader Status

Shows whether the system has received an RFID read recently.

Logic:

```text
If last RFID read was within the last 60 seconds:
    Reader Status = Active

If last RFID read was more than 60 seconds ago:
    Reader Status = No Recent Reads

If no reads have been received:
    Reader Status = Waiting for Reads
```

Example:

```text
Reader Status
Active
```

---

# 4. Live Gannomat Queue Table

This is the most important section of the dashboard.

This table should show parts that are currently in the Gannomat or have an active issue.

Include sessions where:

```text
status IN ('In Process', 'Missing Entrance', 'Missing Exit', 'No RTLS Match', 'Alert')
```

Table title:

```text
Live Gannomat Queue
```

Columns:

| Column        | Description                                                  |
| ------------- | ------------------------------------------------------------ |
| IBUS #        | The IBUS number for the part                                 |
| EPC           | RFID tag value                                               |
| Status        | Current station status                                       |
| Entrance Time | Time the entrance antenna first detected the part            |
| Exit Time     | Time the exit antenna detected the part, if available        |
| Current Dwell | Live timer showing how long the part has been in the station |
| Operator      | Operator matched from RTLS                                   |
| Last Seen     | Last RFID read time                                          |
| Last Antenna  | Entrance or Exit                                             |
| RSSI          | Last read signal strength                                    |
| Alerts        | Any active alert for the session                             |

Example row:

| IBUS #     | EPC              | Status     | Entrance Time | Exit Time | Current Dwell | Operator | Last Seen  | Last Antenna | RSSI | Alerts |
| ---------- | ---------------- | ---------- | ------------- | --------- | ------------- | -------- | ---------- | ------------ | ---- | ------ |
| IBUS459463 | E28069150000401E | In Process | 8:42:15 AM    | —         | 12 min 10 sec | John D.  | 8:54:20 AM | Entrance     | -48  | —      |

## Current Dwell Logic

If the part is still in process:

```text
current_dwell = current_time - entrance_time
```

If the part is completed:

```text
current_dwell = exit_time - entrance_time
```

If there is no entrance time:

```text
current_dwell = —
```

The frontend should update the live dwell timer every second for rows with status `In Process`.

## Row Color Logic

Use visual row indicators:

| Status           | Row Style    |
| ---------------- | ------------ |
| In Process       | Normal row   |
| Completed        | Green badge  |
| Missing Entrance | Red badge    |
| Missing Exit     | Red badge    |
| No RTLS Match    | Yellow badge |
| Alert            | Red badge    |

Do not make the dashboard too busy. Use simple badges and clear text.

---

# 5. Recently Completed Sessions Table

This table should show recently completed Gannomat sessions.

Table title:

```text
Recently Completed
```

Include sessions where:

```text
status = Completed
```

Sort by:

```text
exit_time DESC
```

Limit:

```text
Show the most recent 25 completed sessions
```

Columns:

| Column        | Description          |
| ------------- | -------------------- |
| IBUS #        | IBUS number          |
| Status        | Completed            |
| Entrance Time | First entrance read  |
| Exit Time     | Exit read            |
| Dwell Time    | Total dwell time     |
| Operator      | Matched operator     |
| Last RSSI     | Last signal strength |

Example row:

| IBUS #     | Status    | Entrance Time | Exit Time  | Dwell Time   | Operator | Last RSSI |
| ---------- | --------- | ------------- | ---------- | ------------ | -------- | --------- |
| IBUS459464 | Completed | 8:30:05 AM    | 8:47:11 AM | 17 min 6 sec | Maria S. | -52       |

---

# 6. Active Alerts Panel

The dashboard should have a panel for open alerts.

Panel title:

```text
Active Alerts
```

Show alerts from the `station_alerts` table where:

```text
status = Open
```

Columns:

| Column     | Description              |
| ---------- | ------------------------ |
| Time       | Alert created time       |
| IBUS #     | IBUS related to alert    |
| Alert Type | Type of alert            |
| Message    | Description of the issue |
| Severity   | Low, Medium, High        |
| Status     | Open or Resolved         |

Example:

| Time    | IBUS #     | Alert Type       | Message                                            | Severity | Status |
| ------- | ---------- | ---------------- | -------------------------------------------------- | -------- | ------ |
| 9:15 AM | IBUS459465 | Missing Entrance | Exit read detected with no matching entrance read. | High     | Open   |

## Required Alert Types

The dashboard should support these alert types:

```text
Missing Entrance
Missing Exit
No RTLS Match
Encoding Failed
Duplicate Tag
Long Dwell Time
Unknown EPC
Reader Error
```

## Alert Display Rules

High severity alerts should be visually obvious.

Recommended display:

```text
High = Red badge
Medium = Yellow badge
Low = Gray badge
```

---

# 7. Recent RFID Reads Panel

The dashboard should also show a small live feed of recent raw RFID reads for troubleshooting.

Panel title:

```text
Recent RFID Reads
```

This panel should show the most recent 20 RFID events from `rfid_events`.

Columns:

| Column    | Description                   |
| --------- | ----------------------------- |
| Read Time | RFID read timestamp           |
| IBUS #    | Decoded or mapped IBUS number |
| EPC       | Raw RFID tag value            |
| Station   | Station name                  |
| Antenna   | Entrance or Exit              |
| RSSI      | Signal strength               |
| Reader    | Reader ID                     |

Example row:

| Read Time  | IBUS #     | EPC              | Station  | Antenna  | RSSI | Reader          |
| ---------- | ---------- | ---------------- | -------- | -------- | ---- | --------------- |
| 9:41:55 AM | IBUS459463 | E28069150000401E | Gannomat | Entrance | -48  | FX9600_GANNOMAT |

This panel is mainly for debugging. The main dashboard should still be driven by `station_sessions`.

---

# 8. Backend API Requirements

The frontend should load initial data through normal HTTP API calls, then receive live updates through WebSocket.

## Required HTTP Endpoints

### GET /api/dashboard/summary

Returns the card values.

Example response:

```json
{
  "parts_in_process": 3,
  "completed_today": 42,
  "average_dwell_seconds_today": 862,
  "average_dwell_display_today": "14 min 22 sec",
  "active_alerts": 2,
  "last_rfid_read_time": "2026-06-26T09:41:55",
  "reader_status": "Active"
}
```

### GET /api/gannomat/live-status

Returns active station sessions.

Example response:

```json
[
  {
    "session_id": 5001,
    "ibus_number": "IBUS459463",
    "epc": "E28069150000401E",
    "station_name": "Gannomat",
    "status": "In Process",
    "entrance_time": "2026-06-26T08:42:15",
    "exit_time": null,
    "dwell_time_seconds": null,
    "operator_name": "John D.",
    "last_seen_time": "2026-06-26T08:54:20",
    "last_antenna_location": "Entrance",
    "last_rssi": -48,
    "alert_flag": false,
    "open_alerts": []
  }
]
```

### GET /api/gannomat/completed

Returns recently completed sessions.

Example response:

```json
[
  {
    "session_id": 5002,
    "ibus_number": "IBUS459464",
    "epc": "E28069150000401F",
    "station_name": "Gannomat",
    "status": "Completed",
    "entrance_time": "2026-06-26T08:30:05",
    "exit_time": "2026-06-26T08:47:11",
    "dwell_time_seconds": 1026,
    "dwell_time_display": "17 min 6 sec",
    "operator_name": "Maria S.",
    "last_rssi": -52
  }
]
```

### GET /api/gannomat/alerts

Returns open alerts.

Example response:

```json
[
  {
    "alert_id": 3001,
    "session_id": 5003,
    "ibus_number": "IBUS459465",
    "station_name": "Gannomat",
    "alert_type": "Missing Entrance",
    "alert_message": "Exit read detected with no matching entrance read.",
    "severity": "High",
    "status": "Open",
    "created_at": "2026-06-26T09:15:22"
  }
]
```

### GET /api/rfid/recent-events

Returns recent raw RFID reads.

Example response:

```json
[
  {
    "event_id": 1001,
    "epc": "E28069150000401E",
    "ibus_number": "IBUS459463",
    "station_name": "Gannomat",
    "antenna_location": "Entrance",
    "reader_id": "FX9600_GANNOMAT",
    "antenna_id": "1",
    "read_time": "2026-06-26T09:41:55",
    "rssi": -48
  }
]
```

---

# 9. WebSocket Requirement

The dashboard must use a WebSocket for live updates.

WebSocket endpoint:

```text
ws://localhost:5000/ws/dashboard
```

If using HTTPS later, use:

```text
wss://server-name/ws/dashboard
```

The WebSocket should send updates whenever:

1. A new RFID event is received
2. A station session is created
3. A station session is updated
4. A station session is completed
5. A new alert is created
6. An alert is resolved
7. RTLS operator association updates a session

---

## WebSocket Connection Behavior

When the dashboard loads:

1. Fetch initial dashboard data using HTTP endpoints.
2. Open WebSocket connection to `/ws/dashboard`.
3. Listen for update messages.
4. Update the frontend immediately when messages are received.
5. If WebSocket disconnects, show `Reconnecting`.
6. Try to reconnect every 3 seconds.
7. When reconnected, refresh all data from HTTP endpoints to make sure nothing was missed.

---

# 10. WebSocket Message Types

All WebSocket messages should be JSON.

Every message should include:

```json
{
  "type": "message_type",
  "timestamp": "2026-06-26T09:41:55",
  "data": {}
}
```

---

## Message Type: rfid_event_received

Send this when a new RFID read is received and inserted into `rfid_events`.

Example:

```json
{
  "type": "rfid_event_received",
  "timestamp": "2026-06-26T09:41:55",
  "data": {
    "event_id": 1001,
    "epc": "E28069150000401E",
    "ibus_number": "IBUS459463",
    "station_name": "Gannomat",
    "antenna_location": "Entrance",
    "reader_id": "FX9600_GANNOMAT",
    "antenna_id": "1",
    "read_time": "2026-06-26T09:41:55",
    "rssi": -48
  }
}
```

Frontend behavior:

```text
Add this event to the Recent RFID Reads panel.
Update Last RFID Read card.
Update Reader Status card.
```

---

## Message Type: station_session_created

Send this when an entrance read creates a new station session.

Example:

```json
{
  "type": "station_session_created",
  "timestamp": "2026-06-26T09:42:01",
  "data": {
    "session_id": 5001,
    "ibus_number": "IBUS459463",
    "epc": "E28069150000401E",
    "station_name": "Gannomat",
    "status": "In Process",
    "entrance_time": "2026-06-26T09:42:01",
    "exit_time": null,
    "dwell_time_seconds": null,
    "operator_name": "Unknown",
    "last_seen_time": "2026-06-26T09:42:01",
    "last_antenna_location": "Entrance",
    "last_rssi": -48,
    "alert_flag": false,
    "open_alerts": []
  }
}
```

Frontend behavior:

```text
Add this session to the Live Gannomat Queue.
Increase Parts In Process card.
Start live dwell timer for this row.
```

---

## Message Type: station_session_updated

Send this when an existing station session is updated but not completed.

Example:

```json
{
  "type": "station_session_updated",
  "timestamp": "2026-06-26T09:44:30",
  "data": {
    "session_id": 5001,
    "ibus_number": "IBUS459463",
    "epc": "E28069150000401E",
    "station_name": "Gannomat",
    "status": "In Process",
    "entrance_time": "2026-06-26T09:42:01",
    "exit_time": null,
    "dwell_time_seconds": null,
    "operator_name": "John D.",
    "last_seen_time": "2026-06-26T09:44:30",
    "last_antenna_location": "Entrance",
    "last_rssi": -50,
    "alert_flag": false,
    "open_alerts": []
  }
}
```

Frontend behavior:

```text
Find the row by session_id.
Update operator, last seen, last antenna, RSSI, status, and alerts.
Keep live dwell timer running.
```

---

## Message Type: station_session_completed

Send this when an exit read completes a station session.

Example:

```json
{
  "type": "station_session_completed",
  "timestamp": "2026-06-26T09:59:30",
  "data": {
    "session_id": 5001,
    "ibus_number": "IBUS459463",
    "epc": "E28069150000401E",
    "station_name": "Gannomat",
    "status": "Completed",
    "entrance_time": "2026-06-26T09:42:01",
    "exit_time": "2026-06-26T09:59:30",
    "dwell_time_seconds": 1049,
    "dwell_time_display": "17 min 29 sec",
    "operator_name": "John D.",
    "last_seen_time": "2026-06-26T09:59:30",
    "last_antenna_location": "Exit",
    "last_rssi": -52,
    "alert_flag": false,
    "open_alerts": []
  }
}
```

Frontend behavior:

```text
Remove this row from Live Gannomat Queue.
Add this row to Recently Completed.
Increase Completed Today card.
Recalculate Average Dwell Time card.
Stop live dwell timer.
```

---

## Message Type: alert_created

Send this when a new alert is created.

Example:

```json
{
  "type": "alert_created",
  "timestamp": "2026-06-26T10:03:15",
  "data": {
    "alert_id": 3001,
    "session_id": 5003,
    "ibus_number": "IBUS459465",
    "station_name": "Gannomat",
    "alert_type": "Missing Entrance",
    "alert_message": "Exit read detected with no matching entrance read.",
    "severity": "High",
    "status": "Open",
    "created_at": "2026-06-26T10:03:15"
  }
}
```

Frontend behavior:

```text
Add alert to Active Alerts panel.
Increase Active Alerts card.
Update related session row to show alert badge.
```

---

## Message Type: alert_resolved

Send this when an alert is resolved.

Example:

```json
{
  "type": "alert_resolved",
  "timestamp": "2026-06-26T10:10:00",
  "data": {
    "alert_id": 3001,
    "session_id": 5003,
    "ibus_number": "IBUS459465",
    "status": "Resolved",
    "resolved_at": "2026-06-26T10:10:00"
  }
}
```

Frontend behavior:

```text
Remove alert from Active Alerts panel or mark it as Resolved.
Decrease Active Alerts card.
Update related session row alerts.
```

---

## Message Type: dashboard_summary_updated

Send this when the backend recalculates summary metrics.

Example:

```json
{
  "type": "dashboard_summary_updated",
  "timestamp": "2026-06-26T10:10:00",
  "data": {
    "parts_in_process": 3,
    "completed_today": 42,
    "average_dwell_seconds_today": 862,
    "average_dwell_display_today": "14 min 22 sec",
    "active_alerts": 2,
    "last_rfid_read_time": "2026-06-26T10:09:55",
    "reader_status": "Active"
  }
}
```

Frontend behavior:

```text
Update all summary cards.
```

---

# 11. Dashboard Data Source Rules

The dashboard should get data from these database tables/views:

## Main live table

```text
station_sessions
```

## Alerts

```text
station_alerts
```

## Raw RFID feed

```text
rfid_events
```

## Operator association

```text
rtls_events
```

If a database view exists, the main dashboard should prefer:

```text
vw_gannomat_live_status
```

The dashboard should not perform station logic itself. It should only display the state provided by the backend.

---

# 12. Frontend State Management

The frontend should maintain these state arrays:

```text
summary
liveSessions
completedSessions
activeAlerts
recentRfidEvents
websocketStatus
```

Example state:

```json
{
  "summary": {
    "parts_in_process": 3,
    "completed_today": 42,
    "average_dwell_display_today": "14 min 22 sec",
    "active_alerts": 2,
    "last_rfid_read_time": "2026-06-26T10:09:55",
    "reader_status": "Active"
  },
  "liveSessions": [],
  "completedSessions": [],
  "activeAlerts": [],
  "recentRfidEvents": [],
  "websocketStatus": "Live"
}
```

When WebSocket messages arrive, update the appropriate state without requiring a page refresh.

---

# 13. Frontend Refresh and Fallback Behavior

The dashboard should work even if the WebSocket temporarily fails.

Required behavior:

```text
On page load:
    Fetch all dashboard data using HTTP.

After page load:
    Use WebSocket for live updates.

If WebSocket disconnects:
    Show Reconnecting status.
    Try to reconnect every 3 seconds.

If reconnect succeeds:
    Refresh all HTTP data once.
    Resume live WebSocket updates.

If reconnect fails for more than 30 seconds:
    Show Offline status.
    Continue trying to reconnect.
```

Optional fallback:

```text
If WebSocket is offline, poll the HTTP endpoints every 10 seconds.
```

---

# 14. Required Visual Design

Use a clean manufacturing dashboard style.

Preferred layout:

```text
Header
Summary Cards
Live Gannomat Queue
Recently Completed
Active Alerts
Recent RFID Reads
```

Use a simple color scheme:

```text
Background: white or light gray
Cards: white
Borders: light gray
Text: dark gray or black
Success: green
Warning: yellow/orange
Error: red
Live status: green
```

The design should be easy to read on a shop-floor monitor.

Avoid unnecessary graphics. Prioritize readable tables, clear statuses, and large enough text.

---

# 15. Live Timer Requirement

For any session with:

```text
status = In Process
entrance_time is not null
exit_time is null
```

The frontend should display a live dwell timer.

The timer should update every second.

Example:

```text
12 min 14 sec
12 min 15 sec
12 min 16 sec
```

The timer should stop when a `station_session_completed` WebSocket message is received.

---

# 16. Sorting Requirements

## Live Gannomat Queue

Sort order:

```text
Oldest entrance_time first
```

Reason:

The part that has been in the station longest should be at the top.

## Recently Completed

Sort order:

```text
Newest exit_time first
```

## Alerts

Sort order:

```text
Newest created_at first
```

## Recent RFID Reads

Sort order:

```text
Newest read_time first
```

---

# 17. Filtering Requirements

Add simple filters at the top of the dashboard tables.

Required filters:

```text
IBUS Search
Status Filter
Operator Filter
Show Only Alerts
```

## IBUS Search

The user should be able to type an IBUS number and filter the dashboard.

Example:

```text
IBUS459463
```

## Status Filter

Options:

```text
All
In Process
Completed
Missing Entrance
Missing Exit
No RTLS Match
Alert
```

## Operator Filter

Dropdown of operators currently shown in the data.

## Show Only Alerts

Checkbox:

```text
Show only rows with active alerts
```

---

# 18. Expected Frontend Components

Create reusable frontend components if using React or a similar framework.

Suggested components:

```text
DashboardPage
SummaryCards
ConnectionStatusBadge
LiveQueueTable
CompletedSessionsTable
AlertsPanel
RecentRfidReadsTable
StatusBadge
DwellTimer
FilterBar
```

---

# 19. Backend Event Flow with WebSocket

When an RFID event is received, backend should do this:

```pseudo
POST /api/rfid/events receives RFID read

Insert raw read into rfid_events

Broadcast WebSocket message:
    type = rfid_event_received

Process entrance or exit logic

If entrance creates new session:
    Insert into station_sessions
    Broadcast:
        type = station_session_created

If entrance updates existing session:
    Update station_sessions
    Broadcast:
        type = station_session_updated

If exit completes session:
    Update station_sessions
    Calculate dwell_time_seconds
    Broadcast:
        type = station_session_completed

If alert is created:
    Insert into station_alerts
    Broadcast:
        type = alert_created

Recalculate summary metrics

Broadcast:
    type = dashboard_summary_updated
```

---

# 20. Acceptance Criteria

The live dashboard is complete when:

1. Dashboard loads without errors.
2. Dashboard displays summary cards.
3. Dashboard displays active Gannomat sessions.
4. Dashboard displays recently completed sessions.
5. Dashboard displays active alerts.
6. Dashboard displays recent RFID reads.
7. Dashboard connects to the WebSocket.
8. WebSocket status shows Live when connected.
9. New RFID reads appear without refreshing the page.
10. New entrance reads create or update a live queue row.
11. Exit reads move a row from Live Queue to Recently Completed.
12. Dwell time is calculated and displayed.
13. In-process dwell timers update every second.
14. Alerts appear live when created.
15. Dashboard reconnects automatically if the WebSocket disconnects.
16. Dashboard refreshes HTTP data after reconnecting.
17. Frontend does not calculate station status from raw RFID events.
18. Frontend uses processed station session data from the backend.
19. Dashboard is readable on a shop-floor monitor.
20. The system works for the Gannomat POC before expanding to other stations.

---

# 21. Important Implementation Note

The frontend dashboard should be treated as a live display layer only.

It should not decide whether a part entered, exited, completed, or failed. The backend should make those decisions.

The frontend should display:

```text
station_sessions
station_alerts
rfid_events
dashboard summary metrics
```

The backend should handle:

```text
RFID read processing
Entrance/exit matching
Dwell time calculation
RTLS operator association
Alert creation
WebSocket broadcasting
```

This keeps the system easier to troubleshoot and easier to expand later to Tenoner, Anderson, and other stations.
