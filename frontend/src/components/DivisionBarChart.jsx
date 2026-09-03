import React from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { mockPowerData } from '../data/mockData';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const DivisionBarChart = ({ selectedBranch, selectedDivision }) => {
  const branchData = mockPowerData[selectedBranch] || [];
  const divisionData = branchData.find(div => div.division === selectedDivision);
  

  if (!divisionData) return null; // If no data is selected

  const data = {
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    datasets: [
      {
        label: `Energy Waste - Division ${selectedDivision}`,
        data: divisionData.weekly,
        backgroundColor: 'rgba(54, 162, 235, 0.6)',
        borderRadius: 6,
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'kWh',
        },
      },
    },
  };

  return (
    <div className="bg-white p-4 mt-6 rounded shadow w-full">
      <h2 className="text-lg font-bold mb-4">Weekly Energy Waste - Division {selectedDivision}</h2>
      <Bar data={data} options={options} />
    </div>
  );
};

export default DivisionBarChart;
