import React, { useState } from 'react';
import DivisionTable from './DivisionTable';
import DivisionBarChart from './DivisionBarChart';
import BranchLineChart from './BranchLineChart';

const Dashboard = () => {
  const [selectedBranch, setSelectedBranch] = useState('CSE');
  const [selectedDivision, setSelectedDivision] = useState(null);

  return (
    <div className='flex flex-col p-6 gap-8'>
      {/* Div A */}
      <div className='flex gap-6 w-full'>
        {/* Left: Dropdown + Table */}
        <div className='w-1/2'>
          <div className='mb-4'>
            <label className='font-semibold mr-2'>Select Branch:</label>
            <select
              className='border px-4 py-2 rounded'
              value={selectedBranch}
              onChange={(e) => {
                setSelectedBranch(e.target.value);
                setSelectedDivision(null); // reset selection
              }}
            >
              <option value="CSE">CSE</option>
              <option value="ECE">ECE</option>
              <option value="MECH">MECH</option>
              <option value="EEE">EEE</option>
              <option value="CIV">CIV</option>

            </select>
          </div>

          <DivisionTable
            selectedBranch={selectedBranch}
            setSelectedDivision={setSelectedDivision}
          />
        </div>

        {/* Right: Bar Chart */}
        <div className='w-1/2 bg-white p-4 rounded shadow'>
          <h3 className='text-lg font-bold mb-2'>Weekly Usage - {selectedDivision || "Select a division"}</h3>
          {selectedBranch && selectedDivision ? (
            <DivisionBarChart
                selectedBranch={selectedBranch}
                selectedDivision={selectedDivision}
            />
            ) : (
            <p className="text-center mt-4 text-gray-500">Select a branch and division to view the chart.</p>
            )}
        </div>
      </div>

      {/* Div B */}
      <div className='w-full bg-white p-4 rounded shadow'>
        <h3 className='text-lg font-bold mb-2'>Branch Comparison - {selectedBranch}</h3>
        <BranchLineChart selectedBranch={selectedBranch} />
        </div>
    </div>
  );
};

export default Dashboard;
