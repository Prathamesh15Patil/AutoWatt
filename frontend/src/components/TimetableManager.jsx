import React, { useState, useEffect } from 'react';
import axios from 'axios';

// Define the backend API URL
// Make sure this matches the port your Node.js server is running on
// If your frontend and backend are on different ports/domains, you'll need CORS properly configured on the backend.
const API_BASE_URL = 'http://localhost:3000'; // !! Adjust if your backend is on a different URL/port !!

const TimetableManager = () => {
  // State to hold the timetable data fetched from the backend
  // This will be a flat array of slot objects
  const [timetable, setTimetable] = useState([]);

  // State for managing UI: selected day, form input, loading state, error state
  const [selectedDay, setSelectedDay] = useState('Monday');
  const [newSlot, setNewSlot] = useState({ start: '', end: '', subject: '', type: 'Class' });
  const [isLoading, setIsLoading] = useState(true); // Track loading state
  const [error, setError] = useState(null); // Track error state

  // --- Data Fetching (Load Timetable on Mount) ---
  useEffect(() => {
    const fetchTimetable = async () => {
      setIsLoading(true);
      setError(null); // Clear previous errors
      try {
        const response = await axios.get(`${API_BASE_URL}/timetable`);
        // Assuming the backend returns the flat array directly now
        setTimetable(response.data);
        console.log('Timetable fetched successfully:', response.data);
      } catch (err) {
        console.error('Error fetching timetable:', err);
        setError('Failed to fetch timetable. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTimetable();
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- Data Saving (Save Timetable to Backend) ---
  const saveTimetableToBackend = async (updatedTimetable) => {
    setIsLoading(true); // Set loading state while saving
    setError(null); // Clear previous errors
    try {
      // Send the *entire* updated timetable array to the backend
      await axios.post(`${API_BASE_URL}/timetable`, updatedTimetable);
      console.log('Timetable saved to backend.');
      // Optionally, re-fetch after saving to ensure state is perfectly synced,
      // but for simple updates, relying on the local state update might be sufficient.
      // fetchTimetable(); // Uncomment this if you need strict synchronization
    } catch (err) {
      console.error('Error saving timetable:', err);
      setError('Failed to save timetable. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // --- UI Actions ---
  const handleAddSlot = () => {
    if (!newSlot.start || !newSlot.end || !newSlot.subject) {
      alert('Please fill in all slot details (Start, End, Subject).');
      return;
    }
    // Create the new slot object, including the selected day
    const addedSlot = { ...newSlot, day: selectedDay };

    // Create a new array with the added slot
    const updatedTimetable = [...timetable, addedSlot];

    // Update local state immediately
    setTimetable(updatedTimetable);
    // Clear the form
    setNewSlot({ start: '', end: '', subject: '', type: 'Class' });

    // Save the entire updated timetable to the backend
    saveTimetableToBackend(updatedTimetable);
  };

  const handleDeleteSlot = (slotToDelete) => {
    // Filter out the slot to delete based on a unique combination of properties
    // Note: This assumes start, end, subject, day, and type uniquely identify a slot for deletion in this context.
    // If you had unique IDs from the DB, you'd use those.
    const updatedTimetable = timetable.filter(
      slot =>
        !(
          slot.day === slotToDelete.day &&
          slot.start === slotToDelete.start &&
          slot.end === slotToDelete.end &&
          slot.subject === slotToDelete.subject &&
          slot.type === slotToDelete.type
        )
    );

    // Update local state
    setTimetable(updatedTimetable);

    // Save the entire updated timetable to the backend
    saveTimetableToBackend(updatedTimetable);
  };

    const handleClearDay = (day) => {
        // Filter out all slots for the selected day
        const updatedTimetable = timetable.filter(slot => slot.day !== day);
        setTimetable(updatedTimetable);
        saveTimetableToBackend(updatedTimetable);
    };

    const handleClearAll = () => {
        // Set timetable to an empty array
        const updatedTimetable = [];
        setTimetable(updatedTimetable);
        // Send an empty array or call the DELETE endpoint if implemented on backend
        saveTimetableToBackend(updatedTimetable); // POSTing an empty array is often sufficient
        // Or call delete: axios.delete(`${API_BASE_URL}/timetable`);
    };


  // Group timetable entries by day for display
  const groupedByDay = timetable.reduce((acc, entry) => {
    acc[entry.day] = acc[entry.day] || [];
    acc[entry.day].push(entry);
    // Sort slots within each day by start time
    acc[entry.day].sort((a, b) => a.start.localeCompare(b.start));
    return acc;
  }, {});

  // Days of the week to display buttons for
  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];


  return (
    <div className="p-4 container mx-auto">
      <h2 className="text-2xl font-bold text-center mb-4">Timetable Manager</h2>

        {/* Loading and Error Indicators */}
        {isLoading && <div className="text-center text-blue-600">Loading timetable...</div>}
        {error && <div className="text-center text-red-600">Error: {error}</div>}

        {/* Render content only when not loading and no error */}
        {!isLoading && !error && (
            <>
                <div className="flex flex-wrap gap-2 justify-center mb-4">
                    {daysOfWeek.map(day => (
                    <button
                        key={day}
                        className={`px-4 py-2 rounded ${selectedDay === day ? 'bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
                        onClick={() => setSelectedDay(day)}
                    >
                        {day}
                    </button>
                    ))}
                </div>

                <div className="bg-white rounded shadow p-4 mb-4">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xl font-semibold">{selectedDay} Schedule</h3>
                         {/* Clear Day Button */}
                        {(groupedByDay[selectedDay]?.length > 0) && (
                             <button onClick={() => handleClearDay(selectedDay)} className="text-red-500 text-sm hover:underline">Clear Day</button>
                         )}
                    </div>

                    {/* Display slots for the selected day */}
                    {(groupedByDay[selectedDay] || []).length > 0 ? (
                        (groupedByDay[selectedDay] || []).map((slot, index) => (
                            <div key={index} className="flex justify-between items-center border-b py-2">
                                <div>
                                    <span className="font-mono text-sm text-gray-700">{slot.start} - {slot.end}</span> | <span className="font-medium">{slot.subject}</span> (<span className="text-blue-500">{slot.type}</span>)
                                </div>
                                <button onClick={() => handleDeleteSlot(slot)} className="text-red-500 hover:underline text-sm">Delete</button>
                            </div>
                        ))
                    ) : (
                        <p className="text-gray-500 italic">No schedule for {selectedDay}.</p>
                    )}

                    <div className="mt-6 pt-4 border-t">
                        <h4 className="font-bold mb-2">Add New Slot for {selectedDay}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                            <input
                            className="border p-2 rounded w-full"
                            type="time" // Use type="time" for time input
                            value={newSlot.start}
                            onChange={e => setNewSlot({ ...newSlot, start: e.target.value })}
                            required
                            />
                            <input
                            className="border p-2 rounded w-full"
                            type="time" // Use type="time" for time input
                            value={newSlot.end}
                            onChange={e => setNewSlot({ ...newSlot, end: e.target.value })}
                            required
                            />
                            <input
                            className="border p-2 rounded col-span-1 sm:col-span-2 w-full"
                            placeholder="Subject / Description"
                            value={newSlot.subject}
                            onChange={e => setNewSlot({ ...newSlot, subject: e.target.value })}
                            required
                            />
                            <select
                            className="border p-2 rounded w-full"
                            value={newSlot.type}
                            onChange={e => setNewSlot({ ...newSlot, type: e.target.value })}
                            >
                                <option value="Class">Class</option>
                                <option value="Break">Break</option>
                                <option value="Lab">Lab</option>
                                <option value="Extra">Extra</option>
                                <option value="Project">Project</option>
                                <option value="OffCheckWindow">Off Check Window</option> {/* Add this type */}
                            </select>
                            <button
                            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 transition-colors w-full sm:w-auto"
                            onClick={handleAddSlot}
                            >
                            Add Slot
                            </button>
                        </div>
                    </div>
                </div>

                {/* Clear All Button (Optional) */}
                {(timetable.length > 0) && (
                     <div className="text-center mt-6">
                        <button onClick={handleClearAll} className="text-red-600 hover:underline">Clear All Timetable Entries</button>
                     </div>
                 )}
            </>
        )}
    </div>
  );
};

export default TimetableManager;