# AutoWatt ⚡

### Smart Energy Monitoring & Power Saving System

AutoWatt is an IoT-based energy management system designed for **classrooms, laboratories, and departments in educational institutions**.

It uses an **ESP32, PIR motion sensor, relay, voltage/current sensors, Node.js, MongoDB, and a React dashboard** to monitor electricity usage and automatically reduce unnecessary power consumption.

## How It Works

AutoWatt combines the **institution's timetable with real-time room activity and electrical measurements**.

```text
              Timetable
                  |
                  v
        +-------------------+
        |   Node.js Server  |
        |   Control Logic   |
        +---------+---------+
                  |
              WebSocket
                  |
                  v
                ESP32
           +------+------+
           |             |
          PIR       Voltage/Current
        Sensor         Sensors
           |             |
           +------+------+
                  |
                  v
                Relay
                  |
                  v
          Electrical Load
```

### During a Scheduled Class

The relay is normally **ON**. After a configured period, the system performs a PIR motion check.

- Motion detected → power remains ON.
- No motion → the system measures consumption for a short period.
- If unnecessary consumption is detected, the relay is switched OFF.

### During Breaks / Energy-Saving Periods

The system periodically checks for motion.

- Motion detected → power is enabled temporarily.
- No motion → consumption is measured and the relay is switched OFF.
- The process continues automatically.

If no timetable entry is active, the system remains in **OFF mode**.

## Energy Monitoring

The ESP32 sends voltage, current, relay status, and measurement data to the Node.js backend through WebSockets.

Power is calculated as:

```text
Power (W) = Voltage × Current
```

Energy consumption is calculated as:

```text
Energy (kWh) = Voltage × Current × Time / 3,600,000
```

The backend tracks **daily energy consumption and wasted energy**, with energy logs stored in MongoDB.

## Dashboard

The React dashboard provides:

- **Energy Dashboard** — division-wise wastage and weekly energy charts
- **Class View** — daily energy consumption, wastage, and estimated electricity cost
- **Timetable Manager** — create and manage timetable slots
- **System Monitoring** — relay state, ESP32 connection, and sensor readings

> **Note:** Class View uses live energy-log data from the backend. The current branch/division dashboard analytics use frontend mock data.

## Technology Stack

**Frontend:** React 19 · Vite · Tailwind CSS · Chart.js · Axios

**Backend:** Node.js · Express · WebSocket (`ws`) · MongoDB · Mongoose

**Hardware:** ESP32 · PIR Sensor · Relay Module · Voltage & Current Sensors

## Project Structure

```text
AutoWatt/
├── backend/
│   ├── server.js
│   ├── models/
│   │   ├── EnergyLog.js
│   │   └── TimetableEntry.js
│   └── routes/
│       └── timetable.js
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Dashboard.jsx
    │   │   ├── ClassView.jsx
    │   │   ├── TimetableManager.jsx
    │   │   └── ...
    │   └── data/
    │       └── mockData.js
    └── package.json
```

## Running Locally

### 1. Start the Backend

```bash
cd backend
npm install
npm start
```

Backend:

```text
http://localhost:3000
```

### 2. Start the Frontend

Open a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend:

```text
http://localhost:5173
```

### 3. Hardware Configuration

Make sure MongoDB is running and update the **ESP32 IP address and WebSocket configuration** in:

```text
backend/server.js
```

The ESP32 must be reachable from the machine running the backend.
