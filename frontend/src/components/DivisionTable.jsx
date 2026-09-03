import React from 'react';
import { mockPowerData } from '../data/mockData';

const DivisionTable = ({ selectedBranch, setSelectedDivision }) => {
  const branchData = mockPowerData[selectedBranch] || [];

  return (
    <div className="bg-white shadow rounded p-4">
      <h2 className="text-lg font-bold mb-4">Division-wise Energy Wastage</h2>
      <table className="w-full text-left border border-gray-300">
        <thead>
          <tr className="bg-gray-100">
            <th className="py-2 px-4 border-b">Division</th>
            <th className="py-2 px-4 border-b">Energy Wasted (kWh)</th>
          </tr>
        </thead>
        <tbody>
          {branchData.map((item) => (
            <tr
              key={item.division}
              className="hover:bg-blue-50 cursor-pointer"
              onClick={() => setSelectedDivision(item.division)}
            >
              <td className="py-2 px-4 border-b">{item.division}</td>
              <td className="py-2 px-4 border-b">{item.totalWasted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DivisionTable;
