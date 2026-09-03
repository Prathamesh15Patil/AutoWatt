const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

router.post("/", (req, res) => {
  const timetable = req.body.timetable;
  const filePath = path.join(__dirname, "../data/timetable.json");

  fs.writeFile(filePath, JSON.stringify(timetable, null, 2), (err) => {
    if (err) {
      console.error("Failed to write file", err);
      return res.status(500).json({ message: "Error saving timetable" });
    }
    res.json({ message: "Timetable saved successfully" });
  });
});

module.exports = router;
