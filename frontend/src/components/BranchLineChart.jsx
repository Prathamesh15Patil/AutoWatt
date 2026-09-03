// components/BranchLineChart.jsx
import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { mockPowerData } from '../data/mockData';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const BranchLineChart = ({ selectedBranch }) => {
  const branchData = mockPowerData[selectedBranch] || [];

  if (branchData.length === 0) return null;

  const data = {
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    datasets: branchData.map((division, index) => ({
      label: `Division ${division.division}`,
      data: division.weekly,
      fill: false,
      borderColor: `hsl(${(index * 60) % 360}, 70%, 50%)`, // Dynamic color
      tension: 0.3,
    })),
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
    <div className="bg-white p-4 mt-2 rounded shadow h-[55vh] w-full">
      <h2 className="text-lg font-bold mb-4">
        Weekly Energy Comparison – {selectedBranch} Divisions
      </h2>
      <div className='h-[800px] w-full '>
        <Line className='mx-auto h-full w-[50%]' data={data} options={options} />
      </div>
    </div>
  );
};

export default BranchLineChart;
