import React, { useState, useEffect } from 'react';
// No longer need dayjs or its format plugin!
// import dayjs from 'dayjs';
// import format from 'dayjs/plugin/format';
// dayjs.extend(format); // No longer needed

// Assuming you have a way to handle authentication, import it here if needed
// import { useAuth } from './AuthContext'; // Example if using AuthContext

// --- Configuration ---
// Replace with your actual electricity price per kWh in Rupees
const PRICE_PER_KWH_RUPEES = 5.80; // Example: 8 Rupees per kWh

// --- ClassView Component ---
function ClassView() {
  const [energyLogs, setEnergyLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // If you have authentication and need a token for requests
  // const { token } = useAuth();

  // Function to format date string to YYYY-MM-DD using native Date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Month is 0-indexed
      const day = date.getDate().toString().padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      console.error("Error formatting date:", dateString, e);
      return 'Error';
    }
  };


  // Fetch data from the backend when the component mounts
  useEffect(() => {
    const fetchEnergyLogs = async () => {
      try {
        // Adjust the URL if your backend is hosted elsewhere or on a different port
        const response = await fetch('http://localhost:3000/energylogs', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            // Include Authorization header if your API requires authentication
            // 'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
            // Handle non-2xx responses
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        const data = await response.json();
        setEnergyLogs(data); // Set the fetched data to state
        setLoading(false); // Turn off loading indicator

      } catch (err) {
        console.error("Failed to fetch energy logs:", err);
        setError(err); // Store the error
        setLoading(false); // Turn off loading indicator even on error
      }
    };

    // Check if fetching is possible (e.g., if authentication is required)
    // if (token) { // Example with token check
       fetchEnergyLogs();
    // } else {
        // Maybe set loading to false and show a message if not authenticated
    //    setLoading(false);
    //    setError(new Error("Authentication required to view logs."));
    // }

     // Add dependencies if fetchEnergyLogs depends on props or state (e.g., token)
  }, [/* token */]); // Empty dependency array means this runs once on mount


  // Render logic based on state (loading, error, data)
  if (loading) {
    return <div className="class-view">Loading energy logs...</div>;
  }

  if (error) {
    return (
      <div className="class-view" style={{ color: 'red' }}>
        Error loading energy logs: {error.message || 'An unknown error occurred.'}
        <p style={{ color: 'red', fontSize: '0.9em' }}>
            Please ensure the backend server is running and accessible at <code>http://localhost:3000</code> and MongoDB is connected.
        </p>
      </div>
    );
  }

  if (!energyLogs || energyLogs.length === 0) {
    return <div className="class-view">No energy logs found.</div>;
  }

  return (
    <div className="class-view">
      <h2>Energy Consumption and Wasted Power Logs</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Total Energy (kWh)</th>
            <th>Wasted Energy (kWh)</th>
            <th>Estimated Wasted Cost (Rupees)</th>
          </tr>
        </thead>
        <tbody>
          {energyLogs.map((log) => {
            // Calculate wasted energy cost
            const wastedRupees = (log.wastedKWh || 0) * PRICE_PER_KWH_RUPEES;
            // Ensure log.totalKWh and log.wastedKWh are numbers and format them
            const totalKwhFormatted = (log.totalKWh || 0).toFixed(5);
            const wastedKwhFormatted = (log.wastedKWh || 0).toFixed(5);
            const wastedRupeesFormatted = wastedRupees.toFixed(2); // Format to 2 decimal places for currency

            return (
              <tr key={log._id || log.date}> {/* Use a unique key, _id from MongoDB is good */}
                {/* Use native function for formatting the date */}
                <td>{formatDate(log.date)}</td>
                <td>{totalKwhFormatted}</td>
                <td>{wastedKwhFormatted}</td>
                <td>{wastedRupeesFormatted}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Optional: Add a note about the price calculation */}
       <p style={{ marginTop: '20px', fontSize: '0.9em', color: '#666' }}>
           * Estimated Wasted Cost in Rupees is calculated using a price of {PRICE_PER_KWH_RUPEES.toFixed(2)} Rupees per kWh.
       </p>

      {/* Add some basic styling if needed */}
      <style jsx>{`
        .class-view {
          margin: 20px;
          font-family: Arial, sans-serif;
          color: #333;
        }
        h2 {
            color: #3498db;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          border-radius: 5px;
          overflow: hidden; /* Ensures border-radius applies to table corners */
        }
        th, td {
          border: 1px solid #ddd;
          padding: 12px;
          text-align: left;
        }
        th {
          background-color: #f2f2f2;
          font-weight: bold;
          color: #555;
        }
        tr:nth-child(even) {
          background-color: #f9f9f9;
        }
        tr:hover {
          background-color: #e9e9e9;
        }
        td:last-child {
            font-weight: bold; /* Highlight the cost */
             color: #e74c3c; /* Reddish color for wasted cost */
        }
      `}</style>
    </div>
  );
}

export default ClassView;