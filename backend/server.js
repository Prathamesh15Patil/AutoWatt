const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const fs = require("fs");
const moment = require("moment");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
require("dotenv").config();

// Models (Assuming these exist in ./models/TimetableEntry.js and ./models/EnergyLog.js)
// Example basic schemas if you don't have them:
// TimetableEntry: { day: String, start: String, end: String, type: String, subject: String }
// EnergyLog: { date: String, totalKWh: Number, wastedKWh: Number }
const TimetableEntry = require("./models/TimetableEntry");
const EnergyLog = require("./models/EnergyLog");

// Configuration
const ESP32_IP_ADDRESS = "192.168.128.187"; // <-- **Make sure this is correct**
const ESP32_WS_PORT = 80; // Default WS port for ESP32
const ESP32_WS_PATH = "/ws"; // WebSocket path on ESP32
const RECONNECT_INTERVAL_MS = 5000; // How often to try reconnecting WS
const NODE_SERVER_PORT = 3000; // Port for the Node.js server
const MONGO_URI = process.env.MONGO_URI;

// Timing Constants (Base) - Defined in minutes or seconds for clarity
const MAIN_LOOP_INTERVAL_MS = 5000; // How often the main control loop runs (in milliseconds)
const ENERGY_SAVE_INTERVAL_MS = 60 * 60 * 1000; // Save energy logs hourly (in milliseconds)

const CLASS_PIR_CHECK_AFTER_MINS = 2; // Time into a class before checking for motion
const ENERGY_SAVING_CHECK_INTERVAL_MINS = 1; // Interval between periodic PIR checks in EnergySaving mode (starts AFTER any hold/cooldown)
const PIR_CHECK_DURATION_SECONDS = 3; // How long the ESP32's PIR sensor is active during a check
const RELAY_ON_DURATION_AFTER_MOTION_MINS = 2; // How long the relay stays ON after motion detection in EnergySaving mode (cooldown) - **Set to 5 mins as requested**
const CLASS_MODE_WASTE_MEASUREMENT_DURATION_MINS = 2; // How long to measure power consumption when no motion is detected but relay is ON in Class mode
const ENERGY_SAVING_HOLD_ON_AFTER_NO_MOTION_MINS = 1; // How long to keep relay ON for measurement when no motion detected but relay was ON in EnergySaving mode

// Timing Constants (Calculated in MS for Timers) - Derived from base constants
const CLASS_PIR_CHECK_AFTER_MS = CLASS_PIR_CHECK_AFTER_MINS * 60 * 1000;
const ENERGY_SAVING_CHECK_INTERVAL_MS_CALCULATED =
  ENERGY_SAVING_CHECK_INTERVAL_MINS * 60 * 1000; // Use a distinct name to avoid conflict with ENERGY_SAVE_INTERVAL_MS
const RELAY_ON_DURATION_AFTER_MOTION_MS =
  RELAY_ON_DURATION_AFTER_MOTION_MINS * 60 * 1000;
const CLASS_MODE_WASTE_MEASUREMENT_DURATION_MS =
  CLASS_MODE_WASTE_MEASUREMENT_DURATION_MINS * 60 * 1000;
const ENERGY_SAVING_HOLD_ON_AFTER_NO_MOTION_MS =
  ENERGY_SAVING_HOLD_ON_AFTER_NO_MOTION_MINS * 60 * 1000;
// PIR_CHECK_DURATION_SECONDS is used directly in the command and the timeout calculation.

// State Variables
let wsClient = null;
let latestData = {
  avgVoltage: 0,
  avgCurrent: 0,
  intervalSeconds: 0, // Expected interval between data points from ESP32
  relay_state: false, // Boolean: true if ON, false if OFF
  relay_status: "Unknown", // String status from ESP32
  timestamp: null, // Timestamp of the latest data update
};
let connectionStatus = "Disconnected"; // 'Connected', 'Connecting', 'Disconnected', 'Error'
let isConnecting = false; // Flag to prevent multiple connection attempts
let connectionAttemptTimeout = null; // Timer for reconnect attempts

// Energy Tracking
let dailyEnergyTotalKWh = 0; // Total energy accumulated today
let dailyWastedEnergyKWh = 0; // Wasted energy accumulated today
let currentLogDate = moment().format("YYYY-MM-DD"); // The date for which logs are currently accumulating

// Operational State
// Modes: 'Class', 'EnergySaving', 'Off', 'Disconnected', 'Initializing'
let currentMode = "Initializing";
// States within modes:
// 'Idle': Default, no specific timed action pending within the mode's logic.
// 'Class_WaitingCheck': In Class mode, waiting for the mid-class PIR check timer.
// 'EnergySaving_WaitingCheck': In EnergySaving mode, waiting for the next periodic PIR check timer.
// 'CheckingPIR': Sent command to ESP32, waiting for PIR event response.
// 'EnergySaving_MotionCooldown': In EnergySaving mode, relay is ON after motion, waiting for it to turn OFF.
// 'MeasuringWaste': (Renamed conceptually) Represents a state where relay is ON for measurement.
// NEW STATE: 'EnergySaving_PostNoMotionHoldOn': In EnergySaving mode, relay stays ON for a period *after* no motion detected, for waste measurement.
let energySavingState = "Idle";

// Timers for state transitions and periodic tasks
let operationalTimers = {
  mainLoop: null, // Timer for the main control loop tick
  energySaveLog: null, // Timer for the periodic energy log saving
  classCheck: null, // Timer for the mid-class check in Class mode
  energySavingCheckInterval: null, // Timer for the periodic check interval in EnergySaving mode
  motionCooldown: null, // Timer for how long to keep relay ON after motion in EnergySaving mode
  wasteMeasurement: null, // Timer for the waste measurement period (used in Class mode)
  postNoMotionHold: null, // NEW TIMER: Timer for the hold ON period after no motion in EnergySaving mode
  pirResponseTimeout: null, // Timer to handle case where ESP32 doesn't respond to PIR check command
};

// Waste Measurement
let powerSamples = []; // Array to store V*I samples during waste measurement
let isMeasuringWaste = false; // Flag indicating if currently measuring waste
let wasteMeasurementStartTime = null; // Timestamp when waste measurement started

// Flag to remember if relay was turned OFF due to no motion in Class mode
// This prevents mainLoopTick from immediately turning it back ON. Reset on mode change.
let relayWasTurnedOffAfterWasteInClass = false;

// Timetable Data
let allTimetableEntries = []; // Cache of timetable entries loaded from DB

// Initialize
console.log(`Server starting. Tracking energy for day: ${currentLogDate}`);

// Database Connection
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB Connected");
    // Listen for disconnection events after initial connection
    mongoose.connection.on("disconnected", () => {
      console.warn("MongoDB Disconnected!");
      // Implement more sophisticated reconnect logic here if needed,
      // but for now, rely on operation failures within functions.
    });
    mongoose.connection.on("connected", () => {
      console.log("MongoDB reconnected!");
    });
    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
    });
  } catch (err) {
    console.error("Initial MongoDB Connection Error:", err);
    // Allow server to start even if DB is down initially.
    // Operations will fail gracefully if checks are in place.
  }
}

// Energy Log Functions
async function loadDailyEnergyLogs(date) {
  if (mongoose.connection.readyState !== 1) {
    console.warn("Not connected to MongoDB, cannot load energy logs.");
    dailyEnergyTotalKWh = 0;
    dailyWastedEnergyKWh = 0; // Ensure zeroed if cannot load
    return;
  }
  try {
    const log = await EnergyLog.findOne({ date });
    if (log) {
      dailyEnergyTotalKWh = log.totalKWh || 0;
      dailyWastedEnergyKWh = log.wastedKWh || 0;
      console.log(
        `Loaded energy for ${date}: Total=${dailyEnergyTotalKWh.toFixed(5)} kWh, Wasted=${dailyWastedEnergyKWh.toFixed(5)} kWh`,
      );
    } else {
      console.log(`No existing energy log found for ${date}. Starting fresh.`);
      dailyEnergyTotalKWh = 0;
      dailyWastedEnergyKWh = 0;
    }
  } catch (error) {
    console.error("Error loading energy log:", error);
    // If loading fails, start fresh to prevent using stale/incorrect data
    dailyEnergyTotalKWh = 0;
    dailyWastedEnergyKWh = 0;
  }
}

async function saveDailyEnergyLogs() {
  const today = moment().format("YYYY-MM-DD");
  // Only save if connected to DB
  if (mongoose.connection.readyState !== 1) {
    console.warn("Not connected to MongoDB, skipping energy log save.");
    return;
  }

  try {
    // Ensure the energy values are numbers before saving
    const totalKWh = parseFloat(dailyEnergyTotalKWh.toFixed(5)) || 0;
    const wastedKWh = parseFloat(dailyWastedEnergyKWh.toFixed(5)) || 0;

    await EnergyLog.updateOne(
      { date: today },
      {
        $set: {
          totalKWh: totalKWh,
          wastedKWh: wastedKWh,
        },
      },
      { upsert: true }, // Create the document if it doesn't exist
    );
    console.log(
      `Saved energy logs for ${today}: Total=${totalKWh} kWh, Wasted=${wastedKWh} kWh`,
    );
  } catch (error) {
    console.error("Error saving energy log:", error);
  }
}

// Timetable Functions
async function loadTimetableFromDB() {
  if (mongoose.connection.readyState !== 1) {
    console.warn(
      "Not connected to MongoDB, cannot load timetable. Using empty cache.",
    );
    allTimetableEntries = []; // Ensure it's empty if cannot load
    return;
  }
  try {
    // Find and sort by day and start time
    allTimetableEntries = await TimetableEntry.find({})
      .sort({ day: 1, start: 1 })
      .lean();
    console.log(`Loaded ${allTimetableEntries.length} timetable entries`);
    // Note: Sorting 'start' as string might not be strictly time-based ('10:00' vs '9:00').
    // Using HH:mm format consistently helps string sort approximate time sort.
  } catch (error) {
    console.error("Error loading timetable:", error);
    allTimetableEntries = []; // Ensure it's empty on error
  }
}

async function saveTimetableToDB(entries) {
  if (mongoose.connection.readyState !== 1) {
    console.warn("Not connected to MongoDB, cannot save timetable.");
    // Throw a specific error that the API endpoint can catch
    const dbError = new Error("Database not connected. Cannot save timetable.");
    dbError.status = 503; // Service Unavailable
    throw dbError;
  }
  try {
    // Ensure the input is an array
    if (!Array.isArray(entries)) {
      console.error("Invalid input for timetable save: Not an array");
      const inputError = new Error(
        "Invalid data format. Request body must be an array.",
      );
      inputError.status = 400; // Bad Request
      throw inputError;
    }

    // Filter and map entries, assigning defaults or skipping invalid ones
    const validEntriesToInsert = entries
      .map((entry) => {
        // Simple sanitization (trimming) and ensuring basic structure
        // Assumes subject, day, start, end, type are expected fields.
        const processedEntry = {
          day: typeof entry.day === "string" ? entry.day.trim() : "",
          start: typeof entry.start === "string" ? entry.start.trim() : "",
          end: typeof entry.end === "string" ? entry.end.trim() : "",
          type: typeof entry.type === "string" ? entry.type.trim() : "",
          // Assign empty string if missing/invalid string. Mongoose required will check existence.
          // If subject must be non-empty, schema needs minlength or custom validator.
          subject:
            typeof entry.subject === "string" ? entry.subject.trim() : "",
          // Add checks/processing for other fields if your schema has them
          // location: typeof entry.location === 'string' ? entry.location.trim() : '',
        };

        // --- Basic Validation Server-Side (before Mongoose schema validation) ---
        // Check for essential required fields based on common sense for a timetable entry.
        // These checks are in addition to Mongoose schema validation.
        if (
          !processedEntry.day ||
          !processedEntry.start ||
          !processedEntry.end ||
          !processedEntry.type
        ) {
          console.warn(
            "Skipping timetable entry due to missing essential fields (day, start, end, or type):",
            entry,
          );
          return null; // Skip this entry
        }
        // Add other checks here if needed, e.g. basic time format validation, valid day name.
        // if (!moment(processedEntry.start, "HH:mm", true).isValid()) { ... }

        return processedEntry; // Keep this entry if basic fields are present
      })
      .filter((entry) => entry !== null); // Filter out any entries marked for skipping

    if (validEntriesToInsert.length < entries.length) {
      console.warn(
        `Filtered out ${entries.length - validEntriesToInsert.length} potentially invalid timetable entries before saving.`,
      );
    }

    await TimetableEntry.deleteMany({}); // Clear existing entries
    console.log("Cleared existing timetable entries.");

    if (validEntriesToInsert.length > 0) {
      // insertMany will trigger Mongoose schema validation on the processed entries
      await TimetableEntry.insertMany(validEntriesToInsert);
      console.log(
        `Attempted to insert ${validEntriesToInsert.length} timetable entries.`,
      );
    } else {
      console.log("No valid timetable entries to insert.");
    }

    await loadTimetableFromDB(); // Reload into memory after saving
    console.log(
      `Timetable save attempt finished. Total entries in memory: ${allTimetableEntries.length}`,
    );
    // Note: allTimetableEntries will now contain only the entries that were successfully inserted
    // and then re-loaded. If insertMany failed validation, allTimetableEntries might be empty
    // if deleteMany succeeded but insertMany failed entirely.
  } catch (error) {
    console.error("Error saving timetable:", error);
    // Re-throw the specific Mongoose validation error or other errors
    if (error.name === "ValidationError") {
      console.error("Mongoose Validation Errors Details:", error.errors);
      const validationError = new Error(
        `Timetable validation failed: ${error.message}`,
      );
      validationError.status = 400; // Bad Request
      validationError.details = error.errors; // Optionally attach details
      throw validationError;
    }
    // Re-throw other types of errors (like database connection errors already handled)
    if (!error.status) error.status = 500; // Default to Internal Server Error
    throw error; // Re-throw the caught error
  }
  // No explicit return needed, success is implicit if no error is thrown.
}

// WebSocket Functions
function connectWebSocket() {
  if (isConnecting || (wsClient && wsClient.readyState === WebSocket.OPEN)) {
    return; // Connection in progress or already open
  }

  console.log(
    `Attempting to connect to WebSocket at ws://${ESP32_IP_ADDRESS}:${ESP32_WS_PORT}${ESP32_WS_PATH}`,
  );
  connectionStatus = "Connecting";
  isConnecting = true;
  clearTimeout(connectionAttemptTimeout); // Clear any pending reconnect before attempting now

  // Add a timeout for the connection attempt itself
  const connectionTimeout = setTimeout(() => {
    console.warn("WebSocket connection attempt timed out.");
    if (wsClient && wsClient.readyState === WebSocket.CONNECTING) {
      wsClient.terminate(); // Force close the attempt
    }
    // 'close' or 'error' handler will be triggered and schedule reconnect
  }, RECONNECT_INTERVAL_MS * 2); // Allow a bit longer than reconnect interval

  wsClient = new WebSocket(
    `ws://${ESP32_IP_ADDRESS}:${ESP32_WS_PORT}${ESP32_WS_PATH}`,
  );

  wsClient.on("open", () => {
    clearTimeout(connectionTimeout); // Clear connection timeout on success
    console.log("WebSocket Connected");
    connectionStatus = "Connected";
    isConnecting = false;
    // Request initial status upon connection
    sendCommand("GET_STATUS");
    // Trigger a mode check to react to the connection (e.g., transition from Disconnected)
    mainLoopTick(); // Re-evaluate mode based on timetable now that we can communicate
  });

  wsClient.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      // console.log('Received WS:', message); // Log all incoming messages - can be noisy

      // Handle ESP32 events (like motion detection)
      if (message.event) {
        console.log(`ESP32 Event: ${message.event}`); // Explicit event logging
        handleEspEvent(message.event);
      }
      // Handle data updates (average values or status)
      else if (message.type === "average" || message.type === "status") {
        const now = moment().toISOString();
        // Use received timestamp if available and valid, otherwise use server time
        const messageTimestamp = moment(message.timestamp);
        const dataTimestamp =
          messageTimestamp.isValid() && message.timestamp
            ? message.timestamp
            : now;

        // Ensure numbers are parsed correctly, default to 0 if invalid
        const receivedData = {
          avgVoltage: parseFloat(message.avgVoltage) || 0,
          avgCurrent: parseFloat(message.avgCurrent) || 0,
          intervalSeconds: parseInt(message.intervalSeconds) || 0,
          relay_state:
            message.relay_state === true ||
            message.relay_state === "true" ||
            false, // Ensure boolean
          relay_status: message.relay_status || "Unknown",
          timestamp: dataTimestamp, // Use parsed timestamp
        };
        latestData = receivedData;

        // Log receipt of data if needed for debugging frequency
        // console.log(`Data update: V=${latestData.avgVoltage.toFixed(2)}, A=${latestData.avgCurrent.toFixed(3)}, State=${latestData.relay_state}, Status=${latestData.relay_status}`);

        accumulateEnergy(latestData); // Process energy data

        // If currently measuring waste, add sample IF relay is ON and there's power
        // Use the received data directly for the sample
        if (
          isMeasuringWaste &&
          receivedData.relay_state &&
          receivedData.avgVoltage > 0 &&
          receivedData.avgCurrent > 0
        ) {
          powerSamples.push({
            voltage: receivedData.avgVoltage,
            current: receivedData.avgCurrent,
            timestamp: receivedData.timestamp, // Use the timestamp from the data
          });
        }
      } else {
        console.log("Received unknown WS message type:", message.type, message);
      }
    } catch (error) {
      console.error(
        "Error processing WebSocket message:",
        data ? data.toString() : "Empty message",
        error,
      );
    }
  });

  wsClient.on("close", (code, reason) => {
    clearTimeout(connectionTimeout); // Clear connection timeout on close
    console.log(
      `WebSocket Disconnected (Code: ${code}, Reason: ${reason || "No Reason"})`,
    );
    connectionStatus = "Disconnected";
    wsClient = null; // Nullify the client instance
    isConnecting = false;
    scheduleReconnect();
    // When disconnected, switch mode to 'Disconnected' and reset operational state
    mainLoopTick(); // Re-evaluate mode now that connection is lost
  });

  wsClient.on("error", (error) => {
    // This event is often followed by a 'close' event, especially for connection errors.
    // Handle error logging here, but state transition should happen on 'close'.
    console.error("WebSocket Error:", error.message);
    // The 'close' event handler will manage the state and reconnect logic.
  });
}

function scheduleReconnect() {
  // Only schedule reconnect if we are not already trying and not connected
  if (
    !isConnecting &&
    (!wsClient || wsClient.readyState === WebSocket.CLOSED)
  ) {
    console.log(
      `Scheduling WebSocket reconnect in ${RECONNECT_INTERVAL_MS / 1000} seconds...`,
    );
    // Clear any existing reconnect timeout to avoid duplicates
    clearTimeout(connectionAttemptTimeout);
    connectionAttemptTimeout = setTimeout(
      connectWebSocket,
      RECONNECT_INTERVAL_MS,
    );
  } else {
    // console.log('Reconnect already in progress or WebSocket open.'); // Too noisy
  }
}

function sendCommand(command) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    console.log(`Sending command to ESP32: ${command}`);
    try {
      wsClient.send(command);
      return true;
    } catch (error) {
      console.error(`Error sending command "${command}":`, error);
      // The error might indicate a problem that will lead to 'close', let that handler manage state.
      return false;
    }
  }
  console.warn(
    `Cannot send command "${command}" - WebSocket not connected. Current status: ${connectionStatus}.`,
  );
  return false;
}

// Energy Calculations
function accumulateEnergy(data) {
  const today = moment().format("YYYY-MM-DD");

  // Check for date rollover
  if (today !== currentLogDate) {
    console.log(
      `Date rollover detected. Saving logs for ${currentLogDate} and starting new day ${today}.`,
    );
    // Use a try-catch here as saveDailyEnergyLogs depends on DB connection
    try {
      saveDailyEnergyLogs(); // Save previous day's logs (async, but fire and forget for rollover)
    } catch (error) {
      console.error("Error saving logs during date rollover:", error);
    }
    currentLogDate = today; // Update current log date
    dailyEnergyTotalKWh = 0; // Reset daily totals
    dailyWastedEnergyKWh = 0;
    // Load data for the new day (async, fire and forget)
    loadDailyEnergyLogs(currentLogDate).catch((error) =>
      console.error("Error loading logs for new day:", error),
    );
  }

  // Calculate energy based on the received data interval
  // Power (W) = Voltage (V) * Current (A)
  // Energy (Ws) = Power (W) * Time (s)
  // Energy (kWh) = (Power (W) * Time (s)) / (1000 W/kW * 3600 s/h) = (V * A * s) / 3,600,000
  // We only accumulate total energy when the relay state is reported as ON by the ESP32
  if (
    data.relay_state &&
    data.avgVoltage > 0 &&
    data.avgCurrent > 0 &&
    data.intervalSeconds > 0
  ) {
    const energyWs = data.avgVoltage * data.avgCurrent * data.intervalSeconds;
    const energyKWh = energyWs / 3600000;
    dailyEnergyTotalKWh += energyKWh;
    // console.log(`Accumulated ${energyKWh.toFixed(8)} kWh (Total: ${dailyEnergyTotalKWh.toFixed(5)} kWh)`); // Too noisy
  }
  // Note: Wasted energy accumulated during waste measurement is added to dailyWastedEnergyKWh
  // and implicitly contributes to dailyEnergyTotalKWh via accumulation *before* calculation/logging.
}

function calculateAndLogWastedPower() {
  console.log("Calculating and logging wasted power...");
  isMeasuringWaste = false; // Stop measurement
  // Ensure any waste measurement timers are cleared (both the main one and the EnergySaving specific one)
  clearTimeout(operationalTimers.wasteMeasurement);
  operationalTimers.wasteMeasurement = null;
  clearTimeout(operationalTimers.postNoMotionHold);
  operationalTimers.postNoMotionHold = null;

  if (powerSamples.length === 0) {
    console.log(
      "No valid power samples collected during waste measurement period.",
    );
    powerSamples = []; // Clear samples anyway
    wasteMeasurementStartTime = null; // Clear start time

    // Determine the intended duration based on mode at the *start* of measurement
    // (or make calculateAndLogWastedPower accept duration as argument)
    // Let's use the mode *when calculation finishes* as a proxy for simplicity here.
    const modeWhenCalculating = currentMode;
    energySavingState = "Idle"; // Default transition state

    // Still need to schedule the next step in the state machine flow based on mode
    if (modeWhenCalculating === "EnergySaving") {
      console.log(
        "Waste calculation finished in EnergySaving mode (no samples). Turning relay OFF and scheduling next check.",
      );
      // Even if no samples, the timer period finished, turn OFF relay and schedule next check
      sendCommand("FORCE_RELAY_OFF"); // Ensure it's off
      scheduleNextEnergyCheck(); // This sets state to EnergySaving_WaitingCheck
    } else if (modeWhenCalculating === "Class") {
      console.log(
        "Waste calculation finished in Class mode (no samples). Turning relay OFF.",
      );
      // In Class mode, if no samples (means relay was already off or power was zero),
      // set the flag so mainLoopTick doesn't force it ON again for this class instance.
      sendCommand("FORCE_RELAY_OFF"); // Ensure it's off
      relayWasTurnedOffAfterWasteInClass = true;
      // State is already set to Idle above.
    } else {
      console.warn(
        `Waste calculation finished in unexpected mode ${modeWhenCalculating} (no samples). State is Idle.`,
      );
      // No relay command or scheduling here for unexpected modes.
    }
    return; // Exit the function
  }

  // Calculate average power during the measurement period from samples
  let totalPowerSum = 0; // Sum of V*I for all samples
  let validSampleCount = 0;
  powerSamples.forEach((sample) => {
    // Only include samples with positive voltage and current
    if (sample.voltage > 0 && sample.current > 0) {
      totalPowerSum += sample.voltage * sample.current;
      validSampleCount++;
    } else {
      // console.log('Skipping zero/negative power sample in waste calculation:', sample);
    }
  });

  const averagePowerWatts =
    validSampleCount > 0 ? totalPowerSum / validSampleCount : 0;

  // Determine the duration used for the waste calculation based on the mode
  // Check the state *before* calculating/logging, as the state triggered this function
  const modeAtStartOfCalculation = currentMode; // Rely on currentMode being correct
  let wasteDurationMinutes = 0;

  if (modeAtStartOfCalculation === "Class") {
    wasteDurationMinutes = CLASS_MODE_WASTE_MEASUREMENT_DURATION_MINS;
  } else if (modeAtStartOfCalculation === "EnergySaving") {
    wasteDurationMinutes = ENERGY_SAVING_HOLD_ON_AFTER_NO_MOTION_MINS;
  } else {
    console.warn(
      `calculateAndLogWastedPower called in unexpected mode ${modeAtStartOfCalculation}. Using 0 duration.`,
    );
    wasteDurationMinutes = 0; // Should not happen in normal flow
  }

  const durationSeconds = wasteDurationMinutes * 60;

  // Calculate wasted energy during the measurement period (kWh)
  // Energy (kWh) = Average Power (W) * Duration (s) / 3,600,000
  const wastedKWh = (averagePowerWatts * durationSeconds) / 3600000;

  dailyWastedEnergyKWh += wastedKWh;
  // Important: Wasted energy is ALREADY part of the dailyEnergyTotalKWh calculation
  // because accumulateEnergy ran while the relay was ON during the measurement period.
  // Do NOT add wastedKWh to dailyEnergyTotalKWh here again.

  console.log(
    `Waste Measurement Complete: Avg Power=${averagePowerWatts.toFixed(3)} W, Duration=${wasteDurationMinutes} mins, Wasted=${wastedKWh.toFixed(5)} kWh (${validSampleCount}/${powerSamples.length} valid samples). Total Wasted Today: ${dailyWastedEnergyKWh.toFixed(5)} kWh`,
  );

  powerSamples = []; // Clear samples
  wasteMeasurementStartTime = null; // Clear start time

  // Save the logs after waste is calculated (async, fire and forget)
  saveDailyEnergyLogs().catch((error) =>
    console.error("Error saving logs after waste calculation:", error),
  );

  // Transition state after waste measurement based on the mode when calculation finished
  const modeWhenCalculationFinished = currentMode; // Rely on currentMode being correct
  energySavingState = "Idle"; // Default transition state

  if (modeWhenCalculationFinished === "EnergySaving") {
    console.log(
      "Waste calculation finished in EnergySaving mode. Turning relay OFF and scheduling next check.",
    );
    // After waste measurement in EnergySaving mode, turn OFF relay and schedule next check
    sendCommand("FORCE_RELAY_OFF"); // Ensure it's off
    scheduleNextEnergyCheck(); // This sets state to EnergySaving_WaitingCheck and schedules the timer
  } else if (modeWhenCalculationFinished === "Class") {
    console.log("Waste calculation finished in Class mode. Turning relay OFF.");
    // After waste measurement in Class mode, turn OFF relay
    sendCommand("FORCE_RELAY_OFF"); // Ensure it's off
    // Set the flag so mainLoopTick doesn't force it ON again for this class period.
    relayWasTurnedOffAfterWasteInClass = true;
    // State is already set to Idle above.
  } else {
    console.warn(
      `Waste calculation finished in unexpected mode ${modeWhenCalculationFinished}. State is Idle.`,
    );
    // No relay command or scheduling here for unexpected modes.
  }
}

function startWastedPowerMeasurement() {
  if (isMeasuringWaste) {
    console.warn("Waste measurement already in progress.");
    return;
  }
  console.log("Starting waste power measurement period...");
  isMeasuringWaste = true;
  powerSamples = []; // Clear any old samples
  wasteMeasurementStartTime = moment();
  // The timer for *ending* the measurement period and triggering calculation/logging
  // is set in handleEspEvent when the state transitions to a measurement state.
}

// Timetable Logic
function isTimeWithinRange(currentTime, startTime, endTime) {
  // currentTime, startTime, endTime expected in "HH:mm" format
  // Uses moment objects for reliable time comparison
  const format = "HH:mm";
  const start = moment(startTime, format);
  const end = moment(endTime, format);
  const current = moment(currentTime, format);

  if (!start.isValid() || !end.isValid() || !current.isValid()) {
    console.error(
      `Invalid time format provided for range check: current=${currentTime}, start=${startTime}, end=${endTime}. Skipping range check.`,
    );
    return false;
  }

  // Handle cases where the end time is on the next day (e.g., 23:00 - 01:00)
  if (end.isBefore(start)) {
    // Check if current time is >= start OR < end (next day)
    return current.isSameOrAfter(start) || current.isBefore(end);
  }
  // Normal case: start <= current < end
  return current.isSameOrAfter(start) && current.isBefore(end);
}

function getCurrentTimetableStatus() {
  // If disconnected, the mode is explicitly 'Disconnected'
  if (connectionStatus !== "Connected") {
    return "Disconnected";
  }

  const now = moment();
  const dayOfWeek = now.format("dddd"); // e.g., "Monday", "Tuesday"
  const currentTime = now.format("HH:mm"); // e.g., "09:30"

  if (!allTimetableEntries || allTimetableEntries.length === 0) {
    // If no timetable data is loaded, default to 'Off' mode
    // console.log('No timetable entries loaded. Defaulting to Off mode.'); // Too noisy in mainLoop
    return "Off";
  }

  for (const entry of allTimetableEntries) {
    // Ensure entry has expected fields and they are strings for comparison
    if (
      typeof entry.day !== "string" ||
      typeof entry.start !== "string" ||
      typeof entry.end !== "string" ||
      typeof entry.type !== "string"
    ) {
      console.warn("Skipping invalid timetable entry structure:", entry);
      continue;
    }

    // Check if the entry's day matches the current day (case-insensitive)
    if (entry.day.trim().toLowerCase() === dayOfWeek.toLowerCase()) {
      // Check if the current time is within the entry's time range
      if (
        isTimeWithinRange(currentTime, entry.start.trim(), entry.end.trim())
      ) {
        const type = entry.type.trim().toLowerCase();
        // Map recognized types to modes
        if (["class", "lab", "lecture"].includes(type)) return "Class";
        if (["break", "energysaving"].includes(type)) return "EnergySaving"; // Group break/energysaving types
        if (["off", "free"].includes(type)) return "Off"; // Explicit 'Off' periods

        // If a valid entry matches but type isn't recognized, default to EnergySaving logic
        console.warn(
          `Unrecognized timetable entry type "${entry.type.trim()}" for ${entry.day}. Treating as EnergySaving.`,
        );
        return "EnergySaving";
      }
    }
  }

  // If no timetable entry matches the current day and time, default to 'Off' mode
  return "Off";
}

// Mode Control and State Machine Management
function resetOperationalState() {
  console.log(
    `Resetting operational state from mode ${currentMode} (state: ${energySavingState})`,
  );
  clearAllOperationalTimers(); // Clear all timers associated with operational states

  energySavingState = "Idle"; // Reset the state machine state
  isMeasuringWaste = false; // Stop any ongoing measurement
  powerSamples = []; // Clear samples
  wasteMeasurementStartTime = null;
  relayWasTurnedOffAfterWasteInClass = false; // Reset the flag for Class mode turn-off
  console.log("Operational state reset. Class waste turn-off flag reset.");

  // Do NOT change currentMode here. mainLoopTick sets the mode based on the timetable/connection.
}

function clearAllOperationalTimers() {
  // console.log('Clearing all operational timers.'); // Can be noisy during resets or frequent ticks
  Object.keys(operationalTimers).forEach((timerKey) => {
    if (operationalTimers[timerKey] !== null) {
      clearTimeout(operationalTimers[timerKey]);
      // console.log(`Cleared timer: ${timerKey}`); // Can be noisy
      operationalTimers[timerKey] = null;
    }
  });
}

// Schedules a PIR check command to the ESP32 and sets a timeout for the response
function schedulePIRCheck(durationSeconds, mode) {
  // Cannot schedule PIR check if disconnected
  if (connectionStatus !== "Connected") {
    console.warn(
      `Cannot schedule PIR check, not connected to ESP32. State remains ${energySavingState}.`,
    );
    // If state was set to CheckingPIR just before calling this, it's now stuck.
    // Need to revert the state and handle the failure scenario.
    // Let's revert state and transition as if no motion immediately.
    const previousState = energySavingState; // Capture state before resetting
    energySavingState = "Idle"; // Revert state
    // Act as if no motion was detected because command failed.
    // This will schedule the next check if in ES mode or return to Idle if in Class mode.
    console.log(
      `Scheduling check failure handler from previous state ${previousState}`,
    );
    handleEspEvent("NO_MOTION_DETECTED_COMMAND_FAILED");
    return false;
  }

  // Ensure the state is 'CheckingPIR' before proceeding, as per the logic flow
  if (energySavingState !== "CheckingPIR") {
    console.warn(
      `schedulePIRCheck called but state is ${energySavingState}, not CheckingPIR. Aborting.`,
    );
    // If state is wrong, attempt to reset.
    resetOperationalState();
    return false;
  }

  // Validate the mode matches the current system mode
  if (mode !== currentMode) {
    console.warn(
      `Attempted to schedule PIR check for mode "${mode}" but current mode is "${currentMode}". Aborting.`,
    );
    // State is CheckingPIR, which is incorrect for the actual currentMode.
    // Revert state and reset operational state.
    resetOperationalState();
    return false;
  }

  console.log(
    `Sending command to start PIR check for ${durationSeconds} seconds in mode ${currentMode}. State is CheckingPIR.`,
  );

  const commandSent = sendCommand(`START_PIR_CHECK ${durationSeconds}`);

  if (commandSent) {
    // Clear any existing timeout just in case (safety)
    clearTimeout(operationalTimers.pirResponseTimeout);
    // Set a timeout for the ESP32 response. If no response within duration + buffer, assume no motion.
    operationalTimers.pirResponseTimeout = setTimeout(
      () => {
        console.log(
          "PIR check response timeout reached. Assuming NO_MOTION_DETECTED.",
        );
        // Transition as if NO_MOTION_DETECTED was received.
        // Use a distinct event name for clarity in logs, but handle it like NO_MOTION_DETECTED.
        handleEspEvent("NO_MOTION_DETECTED_TIMEOUT");
        operationalTimers.pirResponseTimeout = null; // Clear timer reference after execution
      },
      (durationSeconds + 10) * 1000,
    ); // Timeout: PIR duration + 10 seconds grace period

    return true; // Indicate command sent successfully
  } else {
    // If command failed, the state is CheckingPIR which is wrong.
    // Need to handle the failure: revert state, act as if no motion (since we got no data/response).
    console.warn(
      "Failed to send PIR check command. Handling as NO_MOTION_DETECTED due to command failure.",
    );
    // The state was CheckingPIR, now it needs to transition as if no motion was detected immediately.
    // Call handleEspEvent with a failure event.
    handleEspEvent("NO_MOTION_DETECTED_COMMAND_FAILED"); // Use a distinct event name
    // handleEspEvent will manage the state transition based on the event and currentMode.
    return false; // Indicate command failed
  }
}

// Handles events received from the ESP32 WebSocket
function handleEspEvent(event) {
  console.log(
    `Handling ESP event "${event}" in mode ${currentMode} (state: ${energySavingState})`,
  );

  // --- PIR Check Response Handling ---
  // This block only executes if the state machine is expecting a PIR response ('CheckingPIR')
  // OR if the event itself indicates a failure related to a check command.
  const isPirResponseEvent = [
    "MOTION_DETECTED",
    "NO_MOTION_DETECTED",
    "NO_MOTION_DETECTED_TIMEOUT",
    "NO_MOTION_DETECTED_COMMAND_FAILED",
  ].includes(event);

  if (
    energySavingState === "CheckingPIR" ||
    event === "NO_MOTION_DETECTED_COMMAND_FAILED"
  ) {
    // Always clear the response timeout if we receive *any* event related to a PIR check (including failures)
    clearTimeout(operationalTimers.pirResponseTimeout);
    operationalTimers.pirResponseTimeout = null; // Clear timer reference

    const motionDetected = event === "MOTION_DETECTED";
    const noMotionDetected =
      event === "NO_MOTION_DETECTED" ||
      event === "NO_MOTION_DETECTED_TIMEOUT" ||
      event === "NO_MOTION_DETECTED_COMMAND_FAILED"; // Treat timeout or command failure as no motion

    if (motionDetected || noMotionDetected) {
      // Ensure state is set correctly if this was triggered by a command failure event
      if (event === "NO_MOTION_DETECTED_COMMAND_FAILED") {
        console.log("Handling PIR command failure as No Motion Detected.");
        // The state should have been CheckingPIR if the command failed. If not, something is off.
        if (energySavingState !== "CheckingPIR") {
          console.warn(
            `Received COMMAND_FAILED event but state was not CheckingPIR (${energySavingState}). Resetting state.`,
          );
          resetOperationalState(); // Reset state machine to be safe
          return; // Abort handling this event further if state was inconsistent
        }
      } else {
        console.log(
          `PIR check completed: ${motionDetected ? "Motion Detected" : "No Motion Detected"}.`,
        );
      }

      if (currentMode === "EnergySaving") {
        console.log("EnergySaving mode reaction to PIR check result:");
        if (motionDetected) {
          console.log(
            `-> Motion detected. Turning relay ON for cooldown period (${RELAY_ON_DURATION_AFTER_MOTION_MINS} mins).`,
          );
          energySavingState = "EnergySaving_MotionCooldown"; // Move to cooldown state
          sendCommand("FORCE_RELAY_ON");

          // Set timer to turn OFF after cooldown and schedule next check
          clearTimeout(operationalTimers.motionCooldown); // Clear any previous cooldown timer
          operationalTimers.motionCooldown = setTimeout(() => {
            console.log("-> EnergySaving motion cooldown timer reached.");
            // Ensure we are still in EnergySaving mode and the correct state before acting
            if (
              currentMode === "EnergySaving" &&
              energySavingState === "EnergySaving_MotionCooldown"
            ) {
              console.log(
                "-> Turning relay OFF and scheduling next periodic check.",
              );
              sendCommand("FORCE_RELAY_OFF"); // Ensure it's OFF
              scheduleNextEnergyCheck(); // Schedule next check interval (sets state to EnergySaving_WaitingCheck)
            } else {
              console.log(
                `Mode or state changed to ${currentMode}, ${energySavingState} during EnergySaving motion cooldown. Skipping EnergySaving cleanup.`,
              );
              // If mode/state changed, the new mode's logic or resetOperationalState will handle things.
              energySavingState = "Idle"; // Revert state if conditions aren't met
            }
            operationalTimers.motionCooldown = null; // Clear timer reference after execution/check
          }, RELAY_ON_DURATION_AFTER_MOTION_MS);
        } else {
          // No motion detected (includes timeout and command failed)
          console.log("-> No motion detected.");
          // Check latestData.relay_state from the last received status update
          if (latestData.relay_state) {
            // --- LOGIC FOR ENERGY SAVING NO MOTION AND RELAY WAS ON ---
            console.log(
              `-> Relay is ON. Holding ON for ${ENERGY_SAVING_HOLD_ON_AFTER_NO_MOTION_MINS} mins for waste measurement, then turning OFF.`,
            );
            energySavingState = "EnergySaving_PostNoMotionHoldOn"; // NEW STATE
            startWastedPowerMeasurement(); // Starts collecting samples and sets flag

            // Set timer for the hold ON duration
            clearTimeout(operationalTimers.postNoMotionHold); // Clear any previous timer
            operationalTimers.postNoMotionHold = setTimeout(() => {
              console.log(
                "-> EnergySaving post-no-motion hold timer reached. Calculating waste and turning OFF.",
              );
              // Ensure we are still in ES mode and the correct state before acting
              if (
                currentMode === "EnergySaving" &&
                energySavingState === "EnergySaving_PostNoMotionHoldOn"
              ) {
                // Calculate and log waste during this hold period
                calculateAndLogWastedPower(); // Logs waste, sets isMeasuringWaste=false, sets state to Idle, turns OFF, schedules next check
              } else {
                console.log(
                  `Mode or state changed to ${currentMode}, ${energySavingState} during EnergySaving post-no-motion hold. Skipping cleanup.`,
                );
                isMeasuringWaste = false;
                powerSamples = [];
                wasteMeasurementStartTime = null; // Clean up state vars
                energySavingState = "Idle"; // Revert state if conditions aren't met
              }
              operationalTimers.postNoMotionHold = null; // Clear timer reference
            }, ENERGY_SAVING_HOLD_ON_AFTER_NO_MOTION_MS);
          } else {
            console.log(
              "-> Relay is already OFF. Scheduling next periodic check.",
            );
            // Relay is OFF, nothing to turn off or measure waste on. Just schedule the next check.
            // The state should transition from CheckingPIR to EnergySaving_WaitingCheck.
            scheduleNextEnergyCheck(); // This sets state to EnergySaving_WaitingCheck and schedules the timer
          }
        }
      } else if (currentMode === "Class") {
        console.log("Class mode reaction to mid-class PIR check result:");
        if (motionDetected) {
          console.log(
            "-> Motion detected. Relay remains ON (default Class behavior). Exiting check state.",
          );
          // Relay should stay ON. mainLoopTick helps ensure this unless overridden by waste logic.
          energySavingState = "Idle"; // Back to Idle state for Class mode (no more checks needed this class instance)
        } else {
          // No motion detected (includes timeout and command failed)
          console.log("-> No motion detected.");
          // Check latestData.relay_state from the last received status update
          if (latestData.relay_state) {
            console.log(
              `-> Relay is ON. Starting waste measurement for ${CLASS_MODE_WASTE_MEASUREMENT_DURATION_MINS} mins, then turning OFF.`,
            );
            energySavingState = "MeasuringWaste"; // State name remains, implies waste measurement is active while relay is ON
            startWastedPowerMeasurement(); // Starts collecting samples and sets flag

            // Set timer to end waste measurement period, trigger calculation/logging, and turn OFF
            clearTimeout(operationalTimers.wasteMeasurement); // Clear any previous waste timer
            operationalTimers.wasteMeasurement = setTimeout(() => {
              console.log(
                "-> Class waste measurement timer reached. Calculating waste and turning OFF.",
              );
              // Ensure we are still in Class mode and the correct state before acting
              if (
                currentMode === "Class" &&
                energySavingState === "MeasuringWaste"
              ) {
                console.log("-> Calculating waste and turning relay OFF.");
                calculateAndLogWastedPower(); // Logs waste, sets isMeasuringWaste=false, sets relayWasTurnedOffAfterWasteInClass=true, sets state to Idle
                // calculateAndLogWastedPower already handles turning OFF and setting state/flag for Class mode
              } else {
                console.log(
                  `Mode or state changed to ${currentMode}, ${energySavingState} during Class waste measurement. Skipping Class cleanup.`,
                );
                isMeasuringWaste = false;
                powerSamples = [];
                wasteMeasurementStartTime = null; // Clean up state vars
                energySavingState = "Idle"; // Revert state if conditions aren't met
              }
              operationalTimers.wasteMeasurement = null; // Clear timer reference
            }, CLASS_MODE_WASTE_MEASUREMENT_DURATION_MS);
          } else {
            console.log("-> Relay is already OFF. Exiting check state.");
            // Relay is already OFF, nothing to turn off or measure.
            // No need to set the flag as the relay was already OFF before our check.
            energySavingState = "Idle"; // Back to Idle state for Class mode (relay stays off)
          }
        }
      } else {
        // Received a PIR event/timeout but in an unexpected mode/state combination
        console.warn(
          `Received PIR related event "${event}" but in state "${energySavingState}" and unexpected mode "${currentMode}". Resetting state.`,
        );
        resetOperationalState(); // Reset state to be safe
      }
    } else {
      console.warn(
        `Received unknown event "${event}" while in PIR related state (${energySavingState}). Ignoring.`,
      );
      // If in CheckingPIR but received a non-PIR related event, stay in CheckingPIR and wait for timeout or correct event.
      // If in another PIR-related state, non-PIR events are just logged.
    }
  } else {
    // --- Other Event Handling (if any) ---
    // If the event is not a PIR response we were waiting for, log it and ignore for state machine purposes.
    console.log(
      `Received unrelated ESP32 event "${event}". Ignoring for state logic.`,
    );
    // If you add other ESP32 events (e.g., 'BUTTON_PRESSED', 'ERROR_STATE'), handle them here.
  }
}

// Schedules the next periodic check in EnergySaving mode
function scheduleNextEnergyCheck() {
  // Ensure any previous check interval timer is cleared
  clearTimeout(operationalTimers.energySavingCheckInterval);
  operationalTimers.energySavingCheckInterval = null;

  // This function is ONLY relevant for EnergySaving mode
  if (currentMode !== "EnergySaving") {
    console.warn(
      "Attempted to schedule EnergySaving check outside of EnergySaving mode.",
    );
    // Ensure state is not waiting check if mode changes unexpectedly
    if (energySavingState === "EnergySaving_WaitingCheck") {
      energySavingState = "Idle";
    }
    return;
  }
  // Avoid scheduling if already in a specific action state within EnergySaving mode
  if (
    [
      "CheckingPIR",
      "EnergySaving_MotionCooldown",
      "MeasuringWaste",
      "EnergySaving_PostNoMotionHoldOn",
    ].includes(energySavingState)
  ) {
    // This can happen if handleEspEvent finishes a sequence but the main loop tick
    // also checks the state before the next transition completes. Safe to ignore.
    // console.log(`Skipping scheduling next EnergySaving check, state is ${energySavingState}.`); // Too noisy
    return;
  }
  // If state is Idle or EnergySaving_WaitingCheck, we can schedule/re-schedule.

  console.log(
    `Scheduling next periodic EnergySaving check in ${ENERGY_SAVING_CHECK_INTERVAL_MINS} minutes. State is EnergySaving_WaitingCheck.`,
  );
  energySavingState = "EnergySaving_WaitingCheck"; // Indicate waiting for the timer

  operationalTimers.energySavingCheckInterval = setTimeout(() => {
    console.log("EnergySaving check interval timer reached.");
    // Ensure we are still in EnergySaving mode and the correct state before triggering
    if (
      currentMode === "EnergySaving" &&
      energySavingState === "EnergySaving_WaitingCheck"
    ) {
      triggerEnergySavingCheck(); // Start the PIR check process (sets state to CheckingPIR)
    } else {
      console.log(
        `Mode or state changed (${currentMode}, ${energySavingState}) during EnergySaving check wait. Aborting check.`,
      );
      // Revert state if conditions aren't met (should be handled by resetOperationalState but double check)
      energySavingState = "Idle";
    }
    operationalTimers.energySavingCheckInterval = null; // Clear timer reference
  }, ENERGY_SAVING_CHECK_INTERVAL_MS_CALCULATED);
}

// Triggers the PIR check process in EnergySaving mode
function triggerEnergySavingCheck() {
  // This function initiates the 'CheckingPIR' state transition via schedulePIRCheck
  if (currentMode !== "EnergySaving") {
    console.warn(
      "Attempted to trigger EnergySaving check outside of EnergySaving mode.",
    );
    energySavingState = "Idle"; // Ensure state is correct
    return;
  }
  // Set state *before* calling schedulePIRCheck, as schedulePIRCheck validates the state.
  console.log(
    `Triggering EnergySaving PIR check. Setting state to CheckingPIR.`,
  );
  energySavingState = "CheckingPIR";
  // schedulePIRCheck handles sending the command and setting the response timeout.
  // It also handles failure scenarios and transitions state back if needed.
  schedulePIRCheck(PIR_CHECK_DURATION_SECONDS, "EnergySaving");
}

// Triggers the PIR check process in Class mode (once per class period)
function triggerClassPIRCheck() {
  // This function initiates the 'CheckingPIR' state transition via schedulePIRCheck
  if (currentMode !== "Class") {
    console.warn("Attempted to trigger Class check outside of Class mode.");
    energySavingState = "Idle"; // Ensure state is correct
    return;
  }
  // Set state *before* calling schedulePIRCheck, as schedulePIRCheck validates the state.
  console.log(
    `Triggering Class mid-period PIR check. Setting state to CheckingPIR.`,
  );
  energySavingState = "CheckingPIR";
  // schedulePIRCheck handles sending the command and setting the response timeout.
  // It also handles failure scenarios and transitions state back if needed.
  schedulePIRCheck(PIR_CHECK_DURATION_SECONDS, "Class");
}

// Main Control Loop - Runs periodically to manage overall mode and initiate state transitions
function mainLoopTick() {
  const prevMode = currentMode;
  const newMode = getCurrentTimetableStatus();

  // --- Mode Change Detection ---
  if (newMode !== prevMode) {
    console.log(`Mode changed: ${prevMode} -> ${newMode}`);
    currentMode = newMode; // Update mode
    resetOperationalState(); // Reset timers, state, and flags for the new mode

    // Actions on entering a mode
    if (currentMode === "Connected") {
      // Transition from Disconnected -> Connected
      console.log(
        "System is now Connected. Will re-evaluate timetable on next tick.",
      );
      // The next tick will pick up the correct Class/EnergySaving/Off mode.
      // No immediate action needed here beyond the reset.
    } else if (currentMode === "Class") {
      console.log("Entering Class mode.");
      // By default, relay should be ON in Class mode
      if (!latestData.relay_state || latestData.relay_status !== "ON") {
        console.log("-> Ensuring relay is ON.");
        sendCommand("FORCE_RELAY_ON");
      }
      // Class mode starts in Idle. The state machine below will handle scheduling the mid-class check.
    } else if (currentMode === "EnergySaving") {
      console.log("Entering EnergySaving mode.");
      // By default, relay should be OFF in EnergySaving mode
      if (latestData.relay_state || latestData.relay_status !== "OFF") {
        console.log("-> Ensuring relay is OFF.");
        sendCommand("FORCE_RELAY_OFF");
      }
      // EnergySaving mode starts in Idle. The state machine below will handle scheduling the first periodic check.
    } else if (currentMode === "Off") {
      console.log("Entering Off mode.");
      // By default, relay should be OFF in Off mode
      if (latestData.relay_state || latestData.relay_status !== "OFF") {
        console.log("-> Ensuring relay is OFF.");
        sendCommand("FORCE_RELAY_OFF");
      }
      // Off mode stays in Idle. No periodic checks needed.
    } else if (currentMode === "Disconnected") {
      console.log("Entering Disconnected mode. Operational logic paused.");
      // Disconnected mode stays in Idle. No operational checks or commands.
      // resetOperationalState already cleared timers.
    }
  } else {
    // If mode didn't change, just ensure currentMode reflects the latest check result
    currentMode = newMode;
  }

  // --- State Management within the Current Mode ---
  // This section manages the state machine ONLY if the current state requires an action
  // or transition that is initiated by the periodic main loop tick.
  // States like 'CheckingPIR', 'EnergySaving_MotionCooldown', 'MeasuringWaste', 'EnergySaving_PostNoMotionHoldOn'
  // are managed primarily by timeouts and the handleEspEvent function after being triggered.
  // The main loop tick's job for these states is mostly to *not interfere* and wait,
  // or to ensure the relay is in the expected state for that state if necessary.

  switch (currentMode) {
    case "Class":
      // In Class mode, the relay should generally be ON.
      // EXCEPT if it was specifically turned OFF after waste measurement.
      // ALSO EXCEPT if we are currently in 'MeasuringWaste' state (it's ON, but will go OFF soon).
      // ALSO EXCEPT if we are in 'CheckingPIR' (relay state depends on previous state).

      // If currently in 'Idle' state for Class mode:
      // This means we are at the beginning of the class period, or finished a check cycle.
      // We need to schedule the mid-class check ONE time per class period when entering this state initially.
      if (energySavingState === "Idle") {
        // Schedule the ONE mid-class check timer.
        // This timer will transition the state to 'Class_WaitingCheck' while waiting.
        console.log(
          `Class mode (state: Idle). Scheduling mid-class PIR check in ${CLASS_PIR_CHECK_AFTER_MINS} mins.`,
        );
        energySavingState = "Class_WaitingCheck"; // Transition state
        clearTimeout(operationalTimers.classCheck); // Ensure any old timer is cleared
        operationalTimers.classCheck = setTimeout(() => {
          console.log("Mid-class check timer reached.");
          // Ensure we are still in Class mode and the correct state before triggering
          if (
            currentMode === "Class" &&
            energySavingState === "Class_WaitingCheck"
          ) {
            triggerClassPIRCheck(); // Start the PIR check process (sets state to CheckingPIR)
          } else {
            console.log(
              `Mode or state changed (${currentMode}, ${energySavingState}) during Class check wait. Aborting check.`,
            );
            // Revert state if conditions aren't met
            energySavingState = "Idle";
          }
          operationalTimers.classCheck = null; // Clear timer reference
        }, CLASS_PIR_CHECK_AFTER_MS);
      }

      // Logic to ensure the relay state matches the mode/state expectations:
      // In Class mode, the relay should be ON, UNLESS:
      // 1. The `relayWasTurnedOffAfterWasteInClass` flag is true (set after waste measurement -> OFF).
      // 2. We are in 'MeasuringWaste' state (it's ON *during* measurement, will go OFF).
      // 3. We are in 'CheckingPIR' (relay state depends on previous state).
      const isStateWhereRelayIsManagedExternallyOrForcedOff =
        [
          "MeasuringWaste", // Relay is ON, managed by waste timer
          "CheckingPIR", // Relay state depends on previous state
        ].includes(energySavingState) || relayWasTurnedOffAfterWasteInClass; // Or if we explicitly turned it off after waste

      if (!isStateWhereRelayIsManagedExternallyOrForcedOff) {
        // Relay should be ON by default in Class mode (unless one of the exceptions applies)
        if (!latestData.relay_state || latestData.relay_status !== "ON") {
          console.log(
            `Class mode (state: ${energySavingState}). Flag is ${relayWasTurnedOffAfterWasteInClass}. Ensuring relay is ON.`,
          );
          sendCommand("FORCE_RELAY_ON");
        }
      } else if (relayWasTurnedOffAfterWasteInClass) {
        // If the flag is true, the relay should be OFF. Ensure it stays OFF.
        if (latestData.relay_state) {
          console.log(
            `Class mode (state: ${energySavingState}). Flag is true. Ensuring relay is OFF.`,
          );
          sendCommand("FORCE_RELAY_OFF");
        }
      }
      // If state is MeasuringWaste or CheckingPIR, relay state is handled by that specific sequence,
      // mainLoopTick doesn't interfere here.

      break; // End Class mode case

    case "EnergySaving":
      // In EnergySaving mode, the relay should generally be OFF.
      // EXCEPT if in 'EnergySaving_MotionCooldown', 'MeasuringWaste', or 'EnergySaving_PostNoMotionHoldOn' states.

      const isStateWhereRelayShouldBeOnInEnergySaving = [
        "EnergySaving_MotionCooldown", // Relay is ON, managed by cooldown timer
        "MeasuringWaste", // Relay is ON, managed by Class waste timer (shouldn't happen in ES mode, but defensive)
        "EnergySaving_PostNoMotionHoldOn", // NEW STATE: Relay is ON, managed by its specific timer
      ].includes(energySavingState);

      // Ensure relay is OFF unless in a state it should be ON
      if (!isStateWhereRelayShouldBeOnInEnergySaving) {
        if (latestData.relay_state || latestData.relay_status !== "OFF") {
          console.log(
            `EnergySaving mode (state: ${energySavingState}). Ensuring relay is OFF.`,
          );
          sendCommand("FORCE_RELAY_OFF");
        }
      }
      // If state is one of the ON states, or CheckingPIR, relay state is handled by that sequence.

      // If in Idle state, schedule the first periodic check
      // This happens right after entering EnergySaving mode or after resetOperationalState.
      if (energySavingState === "Idle") {
        console.log(
          `EnergySaving mode (state: Idle). Scheduling first periodic check.`,
        );
        scheduleNextEnergyCheck(); // This will set state to EnergySaving_WaitingCheck and schedule the timer
      }
      // If in EnergySaving_WaitingCheck, just wait for the timer (handled by scheduleNextEnergyCheck)
      // If in CheckingPIR, wait for event (handled by handleEspEvent)
      // If in EnergySaving_MotionCooldown, wait for timer (handled by handleEspEvent)
      // If in MeasuringWaste, wait for timer (handled by handleEspEvent)
      // If in EnergySaving_PostNoMotionHoldOn, wait for timer (handled by handleEspEvent)

      break; // End EnergySaving mode case

    case "Off":
      // Ensure relay is OFF
      if (latestData.relay_state || latestData.relay_status !== "OFF") {
        console.log("Off mode. Ensuring relay is OFF.");
        sendCommand("FORCE_RELAY_OFF");
      }
      // Off mode stays in Idle state. Nothing else to schedule.
      break; // End Off mode case

    case "Disconnected":
      // When disconnected, stop operational logic.
      // Relay state is unknown or determined by ESP32 fallback.
      // resetOperationalState (done on mode change) already cleared timers and state.
      // mainLoopTick simply observes the disconnected state.
      break; // End Disconnected mode case

    case "Initializing":
      // Wait for startup process to complete (DB load, WS connect)
      // mainLoopTick will naturally transition out of this once WS is connected
      // and getCurrentTimetableStatus returns something other than 'Disconnected'.
      break; // End Initializing mode case

    default:
      console.warn(`Unknown mode: ${currentMode}. Setting to Off.`);
      currentMode = "Off"; // Default to Off if somehow in a bad mode
      resetOperationalState(); // Clean state
      mainLoopTick(); // Re-run tick with correct mode immediately
      break; // End default case
  }

  // The mainLoopTick is run by a persistent setInterval, so no need to reschedule itself.
}

// Express Server
const app = express();
app.use(bodyParser.json()); // To parse JSON request bodies
// CORS middleware - Allows frontend running on a different origin to access the API
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Allow requests from any origin
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"); // Allow specified methods
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept",
  ); // Allow specified headers
  // Handle preflight requests (OPTIONS) - needed for some requests by browsers
  if (req.method === "OPTIONS") {
    res.sendStatus(200); // Respond to preflight requests
  } else {
    next(); // Pass control to the next handler for actual requests
  }
});

// Routes
app.get("/timetable", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).send("Database not connected.");
  }
  try {
    // Return the currently loaded timetable from memory or fetch again
    // Fetching again ensures it's the latest from DB if DB connect is healthy
    const entries = await TimetableEntry.find({});
    res.json(entries);
  } catch (error) {
    console.error("API Error fetching timetable:", error);
    res.status(500).send("Error fetching timetable");
  }
});

app.post("/timetable", async (req, res) => {
  try {
    // req.body is expected to be an array of timetable entry objects
    // Add basic validation if needed, e.g., checking structure of objects in req.body
    if (!Array.isArray(req.body)) {
      return res.status(400).send("Request body must be an array.");
    }
    await saveTimetableToDB(req.body);
    res.send("Timetable updated and reloaded.");
    // Trigger a loop tick immediately to react to potential mode change
    mainLoopTick();
  } catch (error) {
    console.error("API Error saving timetable:", error);
    // Send the error message and status from saveTimetableToDB
    res
      .status(error.status || 500)
      .send(`Error saving timetable: ${error.message}`);
  }
});

app.delete("/timetable", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).send("Database not connected.");
  }
  try {
    await saveTimetableToDB([]); // Save an empty array to clear
    res.send("Timetable cleared.");
    // Trigger a loop tick immediately
    mainLoopTick();
  } catch (error) {
    console.error("API Error clearing timetable:", error);
    // Send the error message and status from saveTimetableToDB
    res
      .status(error.status || 500)
      .send(`Error clearing timetable: ${error.message}`);
  }
});

app.get("/energylogs", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).send("Database not connected.");
  }
  try {
    // Fetch all logs, sorted by date descending
    const logs = await EnergyLog.find({}).sort({ date: -1 });
    res.json(logs);
  } catch (error) {
    console.error("API Error fetching energy logs:", error);
    res.status(500).send("Error fetching energy logs");
  }
});

// Endpoint to manually send commands to ESP32
app.get("/send/:command", (req, res) => {
  const command = req.params.command ? req.params.command.toUpperCase() : ""; // Ensure command is uppercase
  if (!command) {
    return res.status(400).send("Command parameter is missing.");
  }
  // Add basic validation for allowed commands if needed
  // const allowedCommands = ['FORCE_RELAY_ON', 'FORCE_RELAY_OFF', 'GET_STATUS', 'START_PIR_CHECK']; // Allow start_pir_check?
  // if (!allowedCommands.includes(command.split(' ')[0])) { // Check the first word
  //     return res.status(400).send(`Invalid command: ${command}. Allowed commands are: ${allowedCommands.join(', ')}.`);
  // }

  if (sendCommand(command)) {
    res.send(`Command "${command}" sent.`);
    // Manually triggering commands might change state, so maybe a quick tick?
    // mainLoopTick(); // Consider if manual commands should trigger a state re-evaluation
    // This could be tricky if a manual ON/OFF conflicts with ongoing automation.
    // Let's rely on the next scheduled tick to correct state if needed.
  } else {
    // sendCommand already logs the reason for failure (WS not connected)
    res
      .status(503)
      .send(
        `Command "${command}" could not be sent. WebSocket not connected or command failed.`,
      );
  }
});

// Endpoint to get current status (JSON)
app.get("/status", (req, res) => {
  res.json({
    currentMode: currentMode,
    energySavingState: energySavingState,
    connectionStatus: connectionStatus,
    latestData: latestData,
    dailyEnergyTotalKWh: parseFloat(dailyEnergyTotalKWh.toFixed(5)),
    dailyWastedEnergyKWh: parseFloat(dailyWastedEnergyKWh.toFixed(5)),
    currentLogDate: currentLogDate,
    isMeasuringWaste: isMeasuringWaste,
    powerSamplesCount: powerSamples.length,
    relayWasTurnedOffAfterWasteInClass: relayWasTurnedOffAfterWasteInClass, // Expose flag for debugging
    // Expose timer status for debugging (be cautious with large timer objects)
    // activeTimers: Object.keys(operationalTimers).filter(key => operationalTimers[key] !== null)
  });
});

// Root endpoint serving basic status page
app.get("/", (req, res) => {
  // Note: Using moment() here gives the time when the server rendered the page.
  // For real-time updates without refresh, you'd need WebSockets for status updates.
  res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Energy Monitor</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; line-height: 1.6; background-color: #f4f7f6; color: #333;}
                .container { max-width: 800px; margin: 20px auto; background: #fff; padding: 20px 30px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
                h1, h2 { color: #2c3e50; border-bottom: 1px solid #ecf0f1; padding-bottom: 10px; margin-bottom: 15px;}
                h1 { text-align: center; color: #3498db;}
                .status, .data, .controls { margin-bottom: 25px; padding: 15px; border-radius: 5px; }
                .status { border-left: 4px solid #3498db; background: #eaf4fb; }
                .data { border-left: 4 4px solid #e67e22; background: #fef5e7; }
                .controls { border-left: 4px solid #27ae60; background: #e8f8f5; }

                .status h2 { color: #3498db; margin-top: 0; }
                .data h2 { color: #e67e22; margin-top: 0;}
                .controls h2 { color: #27ae60; margin-top: 0;}

                p { margin: 8px 0; }
                strong { font-weight: bold; }
                a { color: #3498db; text-decoration: none; }
                a:hover { text-decoration: underline; }
                 code { background: #ecf0f1; padding: 2px 4px; border-radius: 4px; font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace; font-size: 0.9em;}
                .relay-on { color: #27ae60; font-weight: bold; }
                .relay-off { color: #e74c3c; font-weight: bold; }
                .status-label { display: inline-block; width: 180px; font-weight: bold; margin-right: 10px;}
                .status-label::after { content: ":"; }
                 .note { font-size: 0.9em; color: #7f8c8d; margin-top: 15px; }
            </style>
             <meta http-equiv="refresh" content="5"> <!-- Auto-refresh every 5 seconds -->
        </head>
        <body>
            <div class="container">
                <h1>Energy Monitoring System Status</h1>
                <p class="note"><em>Page auto-refreshes every 5 seconds.</em></p>

                <div class="status">
                    <h2>Current Status</h2>
                    <p><span class="status-label">Operational Mode</span> <code>${currentMode}</code></p>
                    <p><span class="status-label">Operational State</span> <code>${energySavingState}</code></p>
                    <p><span class="status-label">Relay Status</span> ${latestData.relay_state ? '<span class="relay-on">ON</span>' : '<span class="relay-off">OFF</span>'} (<code>${latestData.relay_status}</code>)</p>
                    <p><span class="status-label">Connection Status</span> <code>${connectionStatus}</code></p>
                    <p><span class="status-label">Last Data Timestamp</span> ${latestData.timestamp ? moment(latestData.timestamp).format("YYYY-MM-DD HH:mm:ss") : "N/A"}</p>
                     <p><span class="status-label">Measuring Waste</span> <code>${isMeasuringWaste ? "Yes (" + powerSamples.length + " samples)" : "No"}</code></p>
                     <p><span class="status-label">Class Force-Off Flag</span> <code>${relayWasTurnedOffAfterWasteInClass}</code></p>
                </div>

                <div class="data">
                    <h2>Energy Data</h2>
                    <p><span class="status-label">Log Date</span> <strong>${currentLogDate}</strong></p>
                    <p><span class="status-label">Total Energy</span> <strong>${dailyEnergyTotalKWh.toFixed(5)}</strong> kWh</p>
                    <p><span class="status-label">Wasted Energy</span> <strong>${dailyWastedEnergyKWh.toFixed(5)}</strong> kWh</p>
                    <p><span class="status-label">Current Power</span> <strong>${latestData.avgVoltage && latestData.avgCurrent ? (latestData.avgVoltage * latestData.avgCurrent).toFixed(3) : 0}</strong> W</p>
                     <p><span class="status-label">Latest Reading</span> ${latestData.avgVoltage.toFixed(2)} V, ${latestData.avgCurrent.toFixed(3)} A (Interval: ${latestData.intervalSeconds}s)</p>
                </div>

                <div class="controls">
                    <h2>Controls & Information</h2>
                    <p><span class="status-label">Timetable API</span> <a href="/timetable" target="_blank"><code>/timetable</code></a> (GET, POST, DELETE)</p>
                    <p><span class="status-label">Energy Logs API</span> <a href="/energylogs" target="_blank"><code>/energylogs</code></a> (GET)</p>
                     <p><span class="status-label">Status API:</span> <a href="/status" target="_blank"><code>/status</code></a> (GET)</p>
                    <p class="status-label" style="margin-bottom: 5px;">Manual Commands</p>
                    <p style="margin-left: 20px;">(use with caution, may override automation temporarily)</p>
                    <ul style="list-style: none; padding-left: 20px;">
                        <li><a href="/send/FORCE_RELAY_ON" target="_blank"><code>/send/FORCE_RELAY_ON</code></a></li>
                        <li><a href="/send/FORCE_RELAY_OFF" target="_blank"><code>/send/FORCE_RELAY_OFF</code></a></li>
                        <li><a href="/send/GET_STATUS" target="_blank"><code>/send/GET_STATUS</code></a></li>
                         <!-- Add PIR check command for debugging if needed -->
                         <!-- <li><a href="/send/START_PIR_CHECK%203" target="_blank"><code>/send/START_PIR_CHECK 3</code></a></li> -->
                    </ul>

                    <p class="note">Note: Manual commands may interfere with automated logic. The system will attempt to resume scheduled behavior.</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Startup Sequence
async function startServer() {
  console.log("Starting server initialization...");

  // Ensure data directory exists for potential future file storage (though logs are in DB now)
  if (!fs.existsSync("./data")) {
    try {
      fs.mkdirSync("./data");
      console.log("Created data directory.");
    } catch (error) {
      console.error("Error creating data directory:", error);
      // Do not exit, proceed without data directory if it fails
    }
  }

  // Connect to database
  await connectDB(); // Connect, but don't crash startup if fails initially.
  // Note: MongoDB operations will fail gracefully if checks are in place.

  // Load initial data
  // Use .catch() to prevent unhandled rejection if DB is down during startup load
  await loadTimetableFromDB().catch((error) =>
    console.error("Initial timetable load failed:", error),
  );
  await loadDailyEnergyLogs(currentLogDate).catch((error) =>
    console.error("Initial energy logs load failed:", error),
  );

  // Start periodic timers
  // Save energy logs regularly (only runs if DB is connected inside the function)
  operationalTimers.energySaveLog = setInterval(
    saveDailyEnergyLogs,
    ENERGY_SAVE_INTERVAL_MS,
  );
  // Calculate minutes from the _MS constant for the log message
  console.log(
    `Energy logs scheduled to save every ${ENERGY_SAVE_INTERVAL_MS / (60 * 1000)} minutes.`,
  );

  // Start the main control loop
  operationalTimers.mainLoop = setInterval(mainLoopTick, MAIN_LOOP_INTERVAL_MS);
  console.log(
    `Main loop started, running every ${MAIN_LOOP_INTERVAL_MS / 1000} seconds.`,
  );

  // Initial check of the mode right after loading data
  // This ensures the system immediately enters the correct state based on current time
  // Do this AFTER timers are set up, so state transitions can use them.
  mainLoopTick(); // Run the first tick manually to set initial mode and state

  // Start WebSocket connection attempt
  connectWebSocket();

  // Start HTTP server
  const server = http.createServer(app);
  server.listen(NODE_SERVER_PORT, () => {
    console.log(`HTTP Server running on port ${NODE_SERVER_PORT}`);
  });

  // --- Cleanup on Exit ---
  // Handle signals for graceful shutdown (Ctrl+C, process kill)
  process.on("SIGINT", async () => {
    console.log("SIGINT signal received. Shutting down gracefully...");

    // Clear all timers to stop any pending actions
    clearAllOperationalTimers();
    clearTimeout(connectionAttemptTimeout); // Also clear reconnect timer

    // If currently measuring waste, calculate and log it before exiting
    if (isMeasuringWaste) {
      console.log("Calculating and logging waste before shutdown.");
      // Use a try-catch here in case DB save fails during shutdown
      try {
        calculateAndLogWastedPower(); // This will also attempt to save logs
      } catch (error) {
        console.error("Error during final waste calculation/save:", error);
      }
    } else {
      // Ensure logs are saved even if not measuring waste
      // Use a try-catch here in case DB save fails during shutdown
      try {
        await saveDailyEnergyLogs();
      } catch (error) {
        console.error("Error during final energy log save:", error);
      }
    }

    // Close WebSocket connection
    if (wsClient) {
      // Check if client instance exists
      if (wsClient.readyState === WebSocket.OPEN) {
        console.log("Closing WebSocket connection...");
        wsClient.close(1000, "Server shutting down"); // 1000 is Normal Closure
        // Give it a short time to close cleanly
        await new Promise((resolve) => setTimeout(resolve, 500)); // Wait 500ms
      } else if (wsClient.readyState !== WebSocket.CLOSED) {
        console.log("WebSocket not cleanly closed, terminating client.");
        wsClient.terminate(); // Force close if not in a clean state
      }
      wsClient = null; // Nullify after attempting close/terminate
    }

    // Disconnect from MongoDB
    if (mongoose.connection.readyState === 1) {
      // 1 means connected
      console.log("Disconnecting from MongoDB...");
      try {
        await mongoose.disconnect();
        console.log("MongoDB disconnected.");
      } catch (error) {
        console.error("Error during MongoDB disconnect:", error);
      }
    }

    // Close the HTTP server
    console.log("Closing HTTP server...");
    server.close(() => {
      console.log("HTTP server closed. Process exiting.");
      process.exit(0); // Exit cleanly
    });

    // Set a timeout to force exit if graceful shutdown takes too long
    setTimeout(() => {
      console.error("Graceful shutdown timed out after 10s. Forcing exit.");
      process.exit(1); // Exit with error code
    }, 10000); // 10 seconds timeout
  });

  process.on("SIGTERM", () => {
    console.log("SIGTERM signal received. Shutting down gracefully...");
    process.emit("SIGINT"); // Handle SIGTERM the same way as SIGINT
  });

  // Catch unhandled errors to attempt graceful shutdown
  process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    // Attempt graceful shutdown anyway
    process.emit("SIGINT");
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    // Attempt graceful shutdown anyway
    process.emit("SIGINT");
  });
}

// Start the application sequence
startServer();
