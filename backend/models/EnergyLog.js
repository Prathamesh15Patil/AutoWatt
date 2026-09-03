// backend/models/EnergyLog.js
const mongoose = require('mongoose');

const energyLogSchema = new mongoose.Schema({
  date: {
    type: String, // Storing as 'YYYY-MM-DD' string for easy indexing and querying
    required: true,
    unique: true, // Only one log entry per day
    match: /^\d{4}-\d{2}-\d{2}$/
  },
  totalKWh: {
    type: Number,
    default: 0
  },
  wastedKWh: {
    type: Number,
    default: 0
  },
  // Optional: store other aggregate data if needed
  // usefulKWh: { type: Number, default: 0 } // Could derive from total - wasted
});

// Create a unique index on date for efficient querying
energyLogSchema.index({ date: 1 });

const EnergyLog = mongoose.model('EnergyLog', energyLogSchema);

module.exports = EnergyLog;