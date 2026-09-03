// backend/models/TimetableEntry.js
const mongoose = require('mongoose');

const timetableEntrySchema = new mongoose.Schema({
  day: { type: String, required: true, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
  start: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
  end: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
  subject: { type: String, required: true },
  type: { type: String, required: true, enum: ['Class', 'Break', 'Lab', 'Extra', 'Project', 'OffCheckWindow'] }
});

// Compound index for efficient querying by day and start time
timetableEntrySchema.index({ day: 1, start: 1 });

const TimetableEntry = mongoose.model('TimetableEntry', timetableEntrySchema);

module.exports = TimetableEntry;